// controllers/ledgerController.js
import Student from '../models/Student.js';
import FeeStructure from '../models/FeeStructure.js';
import Payment from '../models/Payment.js';
import Adjustment from '../models/Adjustment.js';
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

    const studentNormalizedClass = normalizeClassName(student.currentClass || student.assignedClass || '');
    const targetTermRegex = new RegExp(`^${term.trim()}$`, 'i');

    // Fetch all adjustments applied to this student
    const adjustments = await Adjustment.find({ studentId: student._id }).lean();
    
    // Filter adjustments for active target term
    const currentTermAdjustments = adjustments.filter(adj => 
      adj.session === session && targetTermRegex.test(adj.term?.trim() || '')
    );

    const totalDiscountsWaivers = adjustments
      .filter(adj => adj.type === 'Discount' || adj.type === 'Waiver')
      .reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);

    // Fetch ALL fee structures to compile historical session expectations dynamically
    const allStructures = await FeeStructure.find({}).lean();
    
    // 🟢 CALCULATE LEGITIMATE HISTORICAL DEBT ONLY
    let pastExpectations = 0;
    allStructures.forEach(struct => {
      // 1. Is this structure from an older term?
      const isHistorical = isOlderTerm(struct.session, struct.term, session, term);
      
      // 2. Was the student ACTUALLY ENROLLED in that older term?
      const wasEnrolled = isStudentEnrolledInTerm(student, struct.session, struct.term);

      if (normalizeClassName(struct.className) === studentNormalizedClass && isHistorical && wasEnrolled) {
        
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
      
      // Map base structure items into a clean lookup object
      const itemsMap = {};
      activeItems.forEach(item => {
        itemsMap[item.name.trim().toLowerCase()] = {
          name: item.name.trim(),
          amount: Number(item.amount) || 0,
          originalAmount: Number(item.amount) || 0,
          appliesTo: item.appliesTo
        };
      });

      // CONSOLIDATE ALL ADJUSTMENTS INTO CLEAN ITEMIZED VALUES
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

    // Dynamic current expected total based on consolidated item amounts
    const currentExpected = currentPersonalizedItems.reduce((sum, item) => sum + item.amount, 0);

    // Fetch all successful payments ever made by this student
    const allSuccessfulPayments = await Payment.find({ studentId, status: 'Successful' }).lean();
    const aggregatePaidAllTime = allSuccessfulPayments.reduce((sum, log) => sum + (Number(log.amountPaid) || 0), 0);
    const basePreviousOutstanding = Number(student.previousOutstanding) || 0;

    // SEQUENTIAL CHRONOLOGICAL ALLOCATION (OLD DEBT FIRST)
    const totalHistoricalDebt = basePreviousOutstanding + pastExpectations;
    let workingCredit = aggregatePaidAllTime;

    // 1. Wipe out older term debts first
    let computedPrevious = Math.max(0, totalHistoricalDebt - workingCredit);
    workingCredit = Math.max(0, workingCredit - totalHistoricalDebt);

    // 2. Remaining credit applies to current term
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
        student,
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

// 🟢 FIXED: Verify receipt authenticity with full class and timestamp payload
export const verifyReceiptAuthenticity = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.status(400).json({ success: false, message: "Missing receipt reference parameters." });
    }

    const cleanedRef = reference.trim();

    // Search Payment log by reference
    const payment = await Payment.findOne({ 
      reference: cleanedRef, 
      status: 'Successful' 
    }).lean();

    if (!payment) {
      return res.status(404).json({ success: false, message: "Receipt reference not recognized by system records." });
    }

    // Fetch associated Student details
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