// controllers/ledgerController.js
import Student from '../models/Student.js';
import FeeStructure from '../models/FeeStructure.js';
import Payment from '../models/Payment.js';
import Adjustment from '../models/Adjustment.js';
import ResultReview from '../models/ResultReview.js'; // 🟢 Added to resolve historical class context
import { normalizeClassName, isOlderTerm, isStudentEnrolledInTerm } from './financeHelpers.js';

// @desc Dynamically calculate and stream student statements with term-isolated allocation
// @route GET /api/finance/student-ledger/:studentId
export const getStudentLedger = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { term, session } = req.query; 

    if (!term || !session) {
      return res.status(400).json({ success: false, message: "Missing term or session query parameters." });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: "Student record profile not found." });
    }

    const targetTermRegex = new RegExp(`^${term.trim()}$`, 'i');

    // Fetch all adjustments and result reviews for historical class mapping
    const adjustments = await Adjustment.find({ studentId: student._id }).lean();
    const allStudentReviews = await ResultReview.find({ studentId: student._id }).lean();

    // Helper to resolve the class the student was in during any specific session/term
    const resolveClassForTerm = (chkSession, chkTerm) => {
      const match = allStudentReviews.find(r => 
        r.session === chkSession && r.term?.trim().toLowerCase() === chkTerm?.trim().toLowerCase()
      );
      if (match && match.className) return match.className;
      return student.currentClass || student.assignedClass || '';
    };

    // Filter adjustments for active target term
    const currentTermAdjustments = adjustments.filter(adj => 
      adj.session === session && targetTermRegex.test(adj.term?.trim() || '')
    );

    const totalDiscountsWaivers = adjustments
      .filter(adj => adj.type === 'Discount' || adj.type === 'Waiver')
      .reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);

    // Fetch ALL fee structures to compile historical session expectations dynamically
    const allStructures = await FeeStructure.find({}).lean();
    
    // 🟢 CALCULATE LEGITIMATE HISTORICAL DEBT WITH HISTORICAL CLASS RESOLUTION
    let pastExpectations = 0;
    allStructures.forEach(struct => {
      const isHistorical = isOlderTerm(struct.session, struct.term, session, term);
      const wasEnrolled = isStudentEnrolledInTerm(student, struct.session, struct.term);

      const historicalClassForStruct = resolveClassForTerm(struct.session, struct.term);
      const normalizedHistoricalClass = normalizeClassName(historicalClassForStruct);

      if (normalizeClassName(struct.className) === normalizedHistoricalClass && isHistorical && wasEnrolled) {
        const intakeSession = String(student.intakeSession || student.admissionSession || student.admittedSession || '').trim();
        const studentType = intakeSession === struct.session ? 'New Students' : 'Returning Students';
        
        struct.items?.forEach(item => {
          if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
            pastExpectations += Number(item.amount) || 0;
          }
        });

        const olderIncreases = adjustments.filter(adj => 
          adj.type === 'Fee Increase' && adj.session === struct.session && adj.term === struct.term
        );
        olderIncreases.forEach(adj => { pastExpectations += Number(adj.amount) || 0; });
      }
    });

    // Resolve current class context for active term view
    const currentClassContext = resolveClassForTerm(session, term);
    const studentNormalizedClass = normalizeClassName(currentClassContext);

    // Extract current target term structure configurations
    const currentStructure = allStructures.find(struct => 
      normalizeClassName(struct.className) === studentNormalizedClass &&
      struct.session === session &&
      targetTermRegex.test(struct.term?.trim() || '')
    );

    const isStructureActive = currentStructure?.status === 'Active' || currentStructure?.status === 'active';

    let currentPersonalizedItems = [];
    const intakeSession = String(student.intakeSession || student.admissionSession || student.admittedSession || '').trim();
    let currentStudentType = intakeSession === session ? 'New Students' : 'Returning Students';

    if (currentStructure) {
      const activeItems = currentStructure.items.filter(item => 
        item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === currentStudentType)
      );
      
      const itemsMap = {};
      activeItems.forEach(item => {
        itemsMap[item.name.trim().toLowerCase()] = {
          name: item.name.trim(),
          amount: Number(item.amount) || 0,
          originalAmount: Number(item.amount) || 0,
          appliesTo: item.appliesTo
        };
      });

      currentTermAdjustments.forEach(adj => {
        const match = adj.reason?.match(/\[Matrix Modification for:\s*(.*?)\]/i);
        const rawTargetName = match ? match[1].trim() : null;
        const targetKey = rawTargetName ? rawTargetName.toLowerCase() : null;

        if (targetKey && itemsMap[targetKey]) {
          if (adj.type === 'Discount' || adj.type === 'Waiver') {
            itemsMap[targetKey].amount = Math.max(0, itemsMap[targetKey].amount - Number(adj.amount));
          } else if (adj.type === 'Fee Increase') {
            itemsMap[targetKey].amount += Number(adj.amount);
          }
        } else if (adj.type === 'Fee Increase') {
          const cleanItemName = adj.reason
            ?.replace(/\[Matrix Modification for:.*?\]\s*-\s*/gi, '')
            ?.replace(/^\[Fee Increase\]\s*/gi, '')
            ?.trim() || 'Custom Fee Adjustment';

          const customKey = cleanItemName.toLowerCase();
          if (itemsMap[customKey]) {
            itemsMap[customKey].amount += Number(adj.amount);
          } else {
            itemsMap[customKey] = {
              name: cleanItemName,
              amount: Number(adj.amount) || 0,
              originalAmount: 0,
              appliesTo: currentStudentType
            };
          }
        } else if (adj.type === 'Discount' || adj.type === 'Waiver') {
          if (rawTargetName) {
            const customKey = rawTargetName.toLowerCase();
            if (itemsMap[customKey]) {
              itemsMap[customKey].amount = Math.max(0, itemsMap[customKey].amount - Number(adj.amount));
            }
          }
        }
      });

      currentPersonalizedItems = Object.values(itemsMap);
    }

    const currentExpected = currentPersonalizedItems.reduce((sum, item) => sum + item.amount, 0);

    const allSuccessfulPayments = await Payment.find({ studentId, status: 'Successful' }).lean();
    const aggregatePaidAllTime = allSuccessfulPayments.reduce((sum, log) => sum + (Number(log.amountPaid) || 0), 0);
    const basePreviousOutstanding = Number(student.previousOutstanding) || 0;

    const totalHistoricalDebt = basePreviousOutstanding + pastExpectations;
    let workingCredit = aggregatePaidAllTime;

    let computedPrevious = Math.max(0, totalHistoricalDebt - workingCredit);
    workingCredit = Math.max(0, workingCredit - totalHistoricalDebt);

    let currentTermAllocatedCredit = Math.min(currentExpected, workingCredit);
    let computedCurrentOutstanding = Math.max(0, currentExpected - currentTermAllocatedCredit);

    let finalPrevious = computedPrevious;
    let finalCurrentExpected = currentExpected;
    let finalCurrentOutstanding = computedCurrentOutstanding;

    if (!isStructureActive) {
      finalPrevious += computedCurrentOutstanding;
      finalCurrentExpected = 0;
      finalCurrentOutstanding = 0;
    }

    res.status(200).json({
      success: true,
      data: {
        student: { ...student.toObject(), currentClass: currentClassContext },
        studentType: currentStudentType,
        items: isStructureActive ? currentPersonalizedItems : [],
        paymentHistory: allSuccessfulPayments.filter(p => p.session === session && targetTermRegex.test(p.term?.trim() || '')),
        currentTermFee: finalCurrentExpected,
        totalPaid: aggregatePaidAllTime,
        currentTermAllocatedCredit,
        totalWaiversDiscounts: totalDiscountsWaivers,
        previousOutstanding: finalPrevious,
        currentTermOutstanding: finalCurrentOutstanding,
        totalOutstanding: finalCurrentOutstanding + finalPrevious
      }
    });
  } catch (error) {
    console.error("Ledger calculation fault:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Process cash payments
export const processCashlessPayment = async (req, res) => {
  try {
    const { studentId, amountPaid, term, session, reference, paymentMethod } = req.body;

    if (!studentId || !amountPaid || !term || !session || !reference) {
      return res.status(400).json({ success: false, message: "Missing explicit checkout payload arguments." });
    }

    const invoiceReceipt = await Payment.create({
      studentId,
      amountPaid: Number(amountPaid),
      term,
      session,
      reference,
      paymentMethod: paymentMethod || 'Online Gateway Channel',
      status: 'Successful'
    });

    res.status(201).json({
      success: true,
      message: "Cashless payment processed, ledger synchronized in real time.",
      data: invoiceReceipt
    });
  } catch (error) {
    console.error("Payment ledger execution fault:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verify receipt authenticity
export const verifyReceiptAuthenticity = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({ success: false, message: "Missing receipt reference parameters." });
    }

    const cleanedRef = reference.trim();

    const payment = await Payment.findOne({ 
      reference: cleanedRef, 
      status: 'Successful' 
    }).lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: "Receipt reference not recognized by system records." });
    }

    const student = await Student.findById(payment.studentId).lean();

    let resolvedName = "Active Student";
    if (student) {
      if (student.name) {
        resolvedName = student.name;
      } else if (student.surname || student.firstName) {
        resolvedName = `${student.surname || ''} ${student.firstName || ''} ${student.otherName || ''}`.replace(/\s+/g, ' ').trim();
      }
    }

    const resolvedClass = payment.className || student?.currentClass || student?.assignedClass || "N/A";
    const resolvedPaidAt = payment.paidAt || payment.createdAt || payment.updatedAt || new Date();

    res.status(200).json({
      success: true,
      data: {
        reference: payment.reference,
        amountPaid: Number(payment.amountPaid || payment.amount) || 0,
        term: payment.term || "First Term",
        session: payment.session || "2026/2027",
        paymentMethod: payment.paymentMethod || "Online Gateway Channel",
        studentName: resolvedName,
        admissionNo: student?.admissionNo || "N/A",
        className: resolvedClass,
        paidAt: resolvedPaidAt
      }
    });
  } catch (error) {
    console.error("💥 Receipt verification failure:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};