// controllers/student/studentProfileController.js
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import FeeStructure from '../../models/FeeStructure.js';
import Payment from '../../models/Payment.js';
import Adjustment from '../../models/Adjustment.js';
import ResultReview from '../../models/ResultReview.js';
import {
  getSessionStartYear,
  getTermOrder,
  normalizeClassName,
  isOlderTerm,
  getSystemConfig,
  compareStructuresChronologically
} from './studentHelpers.js';

/**
 * @route   GET /api/students/profile/me
 * @desc    Fetch profile dashboard data for current student (strictly isolated by campus & class)
 * @access  Private (Student)
 */
export const getStudentProfile = async (req, res) => {
  try {
    const targetId = req.query.studentId || req.params.id;
    
    if (targetId && !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid student identifier format." });
    }

    let query = targetId ? { _id: targetId } : { user: req.user.id };

    let student = await Student.findOne(query)
      .populate('user', 'firstName lastName name email campus')
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto campus');

    if (!student && !targetId && mongoose.Types.ObjectId.isValid(req.user.id)) {
      student = await Student.findById(req.user.id)
        .populate('user', 'firstName lastName name email campus')
        .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto campus');
    }

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: "Isolated student dataset record not found." 
      });
    }

    const systemConfig = await getSystemConfig();
    const currentSession = systemConfig.currentSession;
    const currentTerm = systemConfig.currentTerm;

    // 🟢 Strict trimmed string + campus fallback check
    const studentCampus = String(student.campus || student.user?.campus || 'Emerald Campus').trim();
    const campusRegex = new RegExp(`^${studentCampus.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');

    const actualAdmissionSession = String(student.admittedSession || student.admissionSession || student.intakeSession || currentSession).trim();
    
    const rawAdmittedTerm = 
      student.admissionTerm || 
      student.admittedTerm || 
      student.intakeTerm ||
      student.enrollmentTerm || 
      student.termAdmitted || 
      student.academicTerm || 
      student.currentTerm || 
      currentTerm;

    const actualAdmissionTerm = String(rawAdmittedTerm).trim();
    const admittedTermWeight = getTermOrder(actualAdmissionTerm);

    const adjustments = await Adjustment.find({ studentId: student._id }).lean();
    const allStudentReviews = await ResultReview.find({ studentId: student._id }).lean();

    const resolveClassForTerm = (chkSession, chkTerm) => {
      const match = allStudentReviews.find(r => 
        r.session === chkSession && r.term?.trim().toLowerCase() === chkTerm?.trim().toLowerCase()
      );
      if (match && match.className) return match.className;
      return student.currentClass || student.assignedClass || '';
    };

    const adjustmentCredits = adjustments.filter(adj => adj.type === 'Discount' || adj.type === 'Waiver');
    const adjustmentIncreases = adjustments.filter(adj => adj.type === 'Fee Increase');
    const totalDiscountsWaivers = adjustmentCredits.reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);

    // 🟢 Query fee structures explicitly matching this student's campus via case-insensitive regex
    const allStructures = await FeeStructure.find({ 
      campus: campusRegex 
    }).lean();
    allStructures.sort(compareStructuresChronologically);
    
    let historicalFeeItemsBreakdown = []; 

    allStructures.forEach(struct => {
      if (isOlderTerm(struct.session, struct.term, currentSession, currentTerm)) {
        const historicalClass = resolveClassForTerm(struct.session, struct.term);
        if (normalizeClassName(struct.className) === normalizeClassName(historicalClass)) {
          const structTermWeight = getTermOrder(struct.term);
          if (actualAdmissionSession && struct.session === actualAdmissionSession && structTermWeight > 0 && structTermWeight < admittedTermWeight) {
            return;
          }

          const studentType = actualAdmissionSession === struct.session ? 'New Students' : 'Returning Students';
          
          struct.items?.forEach(item => {
            if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
              historicalFeeItemsBreakdown.push({
                name: item.name,
                amount: Number(item.amount) || 0,
                appliesTo: item.appliesTo,
                term: struct.term,
                session: struct.session
              });
            }
          });

          const termIncreases = adjustmentIncreases.filter(adj => adj.session === struct.session && adj.term === struct.term);
          termIncreases.forEach(adj => {
            historicalFeeItemsBreakdown.push({
              name: `[Fee Increase] ${adj.reason}`,
              amount: Number(adj.amount) || 0,
              appliesTo: 'All Students',
              term: struct.term,
              session: struct.session
            });
          });
        }
      }
    });

    const currentClassContext = resolveClassForTerm(currentSession, currentTerm);
    const studentNormalizedClass = normalizeClassName(currentClassContext);

    // 🟢 Strict multi-field structure match
    const currentStructure = allStructures.find(struct => 
      String(struct.campus).trim().toLowerCase() === studentCampus.toLowerCase() &&
      normalizeClassName(struct.className) === studentNormalizedClass &&
      String(struct.session).trim() === String(currentSession).trim() &&
      new RegExp(`^${currentTerm.trim()}$`, 'i').test(struct.term?.trim() || '')
    );

    const isStructureActive = Boolean(currentStructure && (currentStructure.status === 'Active' || currentStructure.status === 'active'));

    let rawCurrentTermFee = 0;
    let currentPersonalizedItems = []; 
    let currentStudentType = (actualAdmissionSession === currentSession) ? 'New Students' : 'Returning Students';

    if (currentStructure && isStructureActive) {
      const activeItems = (currentStructure.items || []).filter(item => 
        item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === currentStudentType)
      );
      
      currentPersonalizedItems = activeItems.map(item => ({
        name: item.name,
        amount: Number(item.amount) || 0,
        appliesTo: item.appliesTo
      }));

      const currentIncreases = adjustmentIncreases.filter(adj => 
        adj.session === currentSession && new RegExp(`^${currentTerm.trim()}$`, 'i').test(adj.term?.trim() || '')
      );
      currentIncreases.forEach(adj => {
        currentPersonalizedItems.push({
          name: `[Fee Increase] ${adj.reason}`,
          amount: Number(adj.amount) || 0,
          appliesTo: currentStudentType
        });
      });

      rawCurrentTermFee = currentPersonalizedItems.reduce((sum, item) => sum + item.amount, 0);
    }

    const paymentLogs = await Payment.find({ studentId: student._id, status: 'Successful' })
      .sort({ createdAt: -1 })
      .lean();
      
    const totalPaid = paymentLogs.reduce((sum, payment) => sum + (Number(payment.amountPaid) || 0), 0);
    
    const paymentsHistory = paymentLogs.map(p => ({
      reference: p.reference,
      amountPaid: p.amountPaid,
      term: p.term,
      session: p.session,
      paidAt: p.paidAt || p.createdAt
    }));

    let workingCredit = totalPaid + totalDiscountsWaivers;

    const basePreviousOutstanding = Number(student.previousOutstanding) || 0;
    workingCredit = Math.max(0, workingCredit - basePreviousOutstanding);

    const activeHistoricalBreakdown = [];
    historicalFeeItemsBreakdown.forEach(item => {
      const itemCopy = { ...item };
      if (workingCredit >= itemCopy.amount) {
        workingCredit -= itemCopy.amount; 
      } else if (workingCredit > 0) {
        itemCopy.amount -= workingCredit; 
        workingCredit = 0;
        activeHistoricalBreakdown.push(itemCopy);
      } else {
        activeHistoricalBreakdown.push(itemCopy); 
      }
    });

    const activeTermBreakdown = [];
    currentPersonalizedItems.forEach(item => {
      const itemCopy = { ...item };
      if (workingCredit >= itemCopy.amount) {
        workingCredit -= itemCopy.amount;
      } else if (workingCredit > 0) {
        itemCopy.amount -= workingCredit;
        workingCredit = 0;
        activeTermBreakdown.push(itemCopy);
      } else {
        activeTermBreakdown.push(itemCopy);
      }
    });

    const totalAllocatedCredits = totalPaid + totalDiscountsWaivers;

    let finalPrevious = activeHistoricalBreakdown.reduce((sum, item) => sum + item.amount, 0) + 
      (totalAllocatedCredits < basePreviousOutstanding ? (basePreviousOutstanding - totalAllocatedCredits) : 0);
    
    let finalCurrentExpected = isStructureActive ? rawCurrentTermFee : 0;
    let finalCurrentOutstanding = activeTermBreakdown.reduce((sum, item) => sum + item.amount, 0);

    if (!isStructureActive) {
      finalPrevious += finalCurrentOutstanding;
      finalCurrentExpected = 0;
      finalCurrentOutstanding = 0;
    }

    const admissionYear = getSessionStartYear(actualAdmissionSession);
    const activeYear = getSessionStartYear(currentSession);
    const isNewStudent = admissionYear >= activeYear;
    const studentTypeLabel = isNewStudent ? 'New Student' : 'Returning Student';

    const resolvedClassForView = resolveClassForTerm(currentSession, currentTerm) || student.currentClass || "N/A";

    return res.status(200).json({
      success: true,
      student: {
        _id: student._id,
        firstName: student.firstName || student.user?.firstName || student.user?.name?.split(' ')[0] || "Student",
        lastName: student.surname || student.lastName || student.user?.lastName || student.user?.name?.split(' ')[1] || "",
        email: student.email || student.user?.email || "N/A",
        admissionNo: student.admissionNo || student.admissionCode || "N/A",
        campus: studentCampus,
        dob: student.dob || "N/A", 
        gender: student.gender || "N/A",
        address: student.address || student.residentialAddress || "N/A",
        guardianAddress: student.guardianAddress || student.address || "N/A",
        admissionSession: actualAdmissionSession,
        admissionTerm: actualAdmissionTerm,
        academicSession: currentSession, 
        academicTerm: currentTerm,       
        currentClass: resolvedClassForView,
        enrollmentType: studentTypeLabel,
        status: student.status || "Active",
        passportPhoto: student.passportPhoto || null,
        linkedSiblings: student.linkedSiblings || [],
        
        items: isStructureActive ? activeTermBreakdown : [],
        historicalItems: activeHistoricalBreakdown,
        paymentsHistory, 

        financialSummary: {
          currentTermFee: finalCurrentExpected,
          totalPaid,
          totalWaiversDiscounts: totalDiscountsWaivers,
          previousOutstanding: finalPrevious,
          totalOutstanding: finalCurrentOutstanding + finalPrevious
        }
      }
    });
  } catch (error) {
    console.error("💥 Student dashboard profile payload fetch exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Server error retrieving profile dashboard metrics.", 
      error: error.message 
    });
  }
};