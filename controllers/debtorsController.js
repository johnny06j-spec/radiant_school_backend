// controllers/debtorsController.js
import FeeStructure from '../models/FeeStructure.js';
import Student from '../models/Student.js';
import Payment from '../models/Payment.js';
import SystemConfig from '../models/SystemConfig.js';
import Adjustment from '../models/Adjustment.js';
import { normalizeClassName, isOlderTerm, isStudentEnrolledInTerm } from './financeHelpers.js';

// Helper function to extract a student's name safely
const resolveStudentName = (student) => {
  if (!student) return "Active Student";

  let first = student.firstName || "";
  let last = student.surname || student.lastName || "";
  let other = student.otherName || "";

  if (student.name) {
    if (typeof student.name === 'string') {
      return student.name.trim();
    }
    if (typeof student.name === 'object') {
      first = first || student.name.first || student.name.firstName || "";
      last = last || student.name.last || student.name.lastName || "";
    }
  }

  const fullName = `${first} ${other} ${last}`.replace(/\s+/g, " ").trim();
  
  if (fullName.length > 1) {
    return fullName;
  }

  if (student.studentName && typeof student.studentName === 'string') return student.studentName.trim();
  if (student.fullName && typeof student.fullName === 'string') return student.fullName.trim();

  return "Active Student";
};

// Helper function to determine term chronological weight
const getTermOrder = (termName) => {
  if (!termName) return 0;
  const normalized = termName.trim().toLowerCase();
  if (normalized.includes('first') || normalized.includes('1st')) return 1;
  if (normalized.includes('second') || normalized.includes('2nd')) return 2;
  if (normalized.includes('third') || normalized.includes('3rd')) return 3;
  return 0;
};

// @desc Calculate dashboard metrics (Synchronized with active student ledgers)
// @route GET /api/finance/dashboard-summary
export const getGlobalFinanceSummary = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const { session, term } = req.query;
    
    const systemSettings = await SystemConfig.findOne({});
    const targetSession = session || systemSettings?.currentSession || "2026/2027";
    const targetTerm = term || systemSettings?.currentTerm || "First Term";

    const activeStructures = await FeeStructure.find({ session: targetSession, term: targetTerm, status: 'Active' }).lean();
    
    const students = await Student.find({ 
      $or: [
        { status: { $in: ['Active', 'active', null] } },
        { status: { $exists: false } }
      ] 
    }).lean();

    const activeStudentIds = students.map(s => s._id);

    let grossExpected = 0;
    const globalAdjustments = await Adjustment.find({ session: targetSession, term: targetTerm }).lean();

    students.forEach(student => {
      // 🔒 ENROLLMENT GUARD: Skip if student was NOT enrolled in target term
      if (!isStudentEnrolledInTerm(student, targetSession, targetTerm)) {
        return;
      }

      const studentClass = normalizeClassName(student.currentClass || student.assignedClass || '');
      const matchingStructure = activeStructures.find(struct => 
        normalizeClassName(struct.className) === studentClass
      );

      if (matchingStructure?.items) {
        const studentSessionStr = String(student.intakeSession || student.admittedSession || student.admissionSession || student.academicSession || '').trim();
        const isNewIntake = studentSessionStr === targetSession;
        const studentType = isNewIntake ? 'New Students' : 'Returning Students';

        matchingStructure.items.forEach(item => {
          if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
            grossExpected += Number(item.amount) || 0;
          }
        });
      }

      const studentAdjustments = globalAdjustments.filter(adj => String(adj.studentId) === String(student._id));
      studentAdjustments.forEach(adj => {
        if (adj.type === 'Fee Increase') {
          grossExpected += adj.amount;
        } else if (adj.type === 'Discount' || adj.type === 'Waiver') {
          grossExpected -= adj.amount;
        }
      });
    });

    const activePayments = await Payment.aggregate([
      {
        $match: {
          studentId: { $in: activeStudentIds },
          session: targetSession,
          term: targetTerm,
          status: 'Successful'
        }
      },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: '$amountPaid' }
        }
      }
    ]);

    const netCollected = activePayments.length > 0 ? Number(activePayments[0].totalCollected) || 0 : 0;
    const systemArrears = Math.max(0, grossExpected - netCollected);

    return res.status(200).json({
      success: true,
      data: {
        grossExpectedRevenue: Math.max(grossExpected, 0),
        totalNetCollected: netCollected,
        totalSystemArrears: systemArrears
      }
    });
  } catch (error) {
    console.error("Global finance summary broken:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Fetch list of active debtors with chronological outstanding balances
// @route GET /api/finance/debtors
export const getDebtorsList = async (req, res) => {
  try {
    const { search, assignedClass, session, term } = req.query;

    const systemSettings = await SystemConfig.findOne({});
    const targetSession = session || systemSettings?.currentSession || "2026/2027";
    const targetTerm = term || systemSettings?.currentTerm || "First Term";

    let studentQuery = { 
      $or: [
        { status: { $in: ['Active', 'active', null] } },
        { status: { $exists: false } }
      ]
    };

    if (assignedClass && assignedClass !== 'All Classes' && assignedClass !== 'All') {
      studentQuery.$or = [{ currentClass: assignedClass }, { assignedClass: assignedClass }];
    }

    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      studentQuery.$and = [
        {
          $or: [
            { surname: searchRegex },
            { lastName: searchRegex },
            { firstName: searchRegex },
            { otherName: searchRegex },
            { name: searchRegex },
            { studentName: searchRegex },
            { admissionNo: searchRegex }
          ]
        }
      ];
    }

    const students = await Student.find(studentQuery).lean();
    const allStructures = await FeeStructure.find({}).lean();
    const currentTermStructures = allStructures.filter(f => f.session === targetSession && f.term === targetTerm);

    let debtors = [];
    let summaryTotalPrevious = 0;
    let summaryTotalCurrent = 0;
    let summaryTotalAll = 0;
    let uniqueClassesWithDebtors = new Set();

    for (const student of students) {
      // 🔒 1. ENROLLMENT GUARDIAN: Skip students who were not enrolled during this target term/session
      const isEnrolledInTargetTerm = isStudentEnrolledInTerm(student, targetSession, targetTerm);

      const currentClass = student.currentClass || student.assignedClass || "JSS 1";
      const normalizedClass = normalizeClassName(currentClass);
      
      const admittedSession = String(student.intakeSession || student.admittedSession || student.admissionSession || student.academicSession || '').trim();

      const adjustments = await Adjustment.find({ studentId: student._id }).lean();
      const adjustmentCredits = adjustments.filter(adj => adj.type === 'Discount' || adj.type === 'Waiver');
      const adjustmentIncreases = adjustments.filter(adj => adj.type === 'Fee Increase');

      const totalDiscountsWaivers = adjustmentCredits.reduce((sum, adj) => sum + adj.amount, 0);

      // Calculate past term obligations
      let pastExpectations = 0;
      allStructures.forEach(struct => {
        if (normalizeClassName(struct.className) === normalizedClass && isOlderTerm(struct.session, struct.term, targetSession, targetTerm)) {
          
          if (!isStudentEnrolledInTerm(student, struct.session, struct.term)) {
            return;
          }

          const studentType = admittedSession === struct.session ? 'New Students' : 'Returning Students';
          
          struct.items.forEach(item => {
            if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
              pastExpectations += Number(item.amount) || 0;
            }
          });

          const termIncreases = adjustmentIncreases.filter(adj => adj.session === struct.session && adj.term === struct.term);
          termIncreases.forEach(adj => {
            pastExpectations += adj.amount;
          });
        }
      });

      // Calculate target term expectations ONLY IF ENROLLED
      let currentTermExpectedFee = 0;
      if (isEnrolledInTargetTerm) {
        const matchingCurrentStructure = currentTermStructures.find(f => normalizeClassName(f.className) === normalizedClass);
        if (matchingCurrentStructure?.items) {
          const studentType = admittedSession === targetSession ? 'New Students' : 'Returning Students';
          
          matchingCurrentStructure.items.forEach(item => {
            if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
              currentTermExpectedFee += Number(item.amount) || 0;
            }
          });
        }

        const currentIncreases = adjustmentIncreases.filter(adj => adj.session === targetSession && adj.term === targetTerm);
        currentIncreases.forEach(adj => {
          currentTermExpectedFee += adj.amount;
        });
      }

      const matchingCurrentStructure = currentTermStructures.find(f => normalizeClassName(f.className) === normalizedClass);
      const isStructureActive = matchingCurrentStructure?.status === 'Active' || matchingCurrentStructure?.status === 'active';

      const payments = await Payment.find({ studentId: student._id, status: 'Successful' }).lean();
      const grandTotalPaid = payments.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
      const basePreviousOutstanding = Number(student.previousOutstanding) || 0;

      let totalDebtToResolve = basePreviousOutstanding + pastExpectations;
      let remainingPaymentCredit = grandTotalPaid + totalDiscountsWaivers;

      let computedPrevious = Math.max(0, totalDebtToResolve - remainingPaymentCredit);
      remainingPaymentCredit = Math.max(0, remainingPaymentCredit - totalDebtToResolve);

      let computedCurrentTermOutstanding = Math.max(0, currentTermExpectedFee - remainingPaymentCredit);

      let computedCurrent = 0;
      let computedPreviousWithTerm = computedPrevious;

      if (isStructureActive) {
        computedCurrent = computedCurrentTermOutstanding;
      } else {
        computedPreviousWithTerm += computedCurrentTermOutstanding;
      }

      let studentTotalOutstanding = computedPreviousWithTerm + computedCurrent;

      if (studentTotalOutstanding > 0) {
        const computedName = resolveStudentName(student);

        debtors.push({
          _id: student._id,
          studentName: computedName,
          admissionNo: student.admissionNo || "N/A",
          class: currentClass,
          previousOutstanding: computedPreviousWithTerm,
          currentOutstanding: computedCurrent,
          totalOutstanding: studentTotalOutstanding
        });

        summaryTotalPrevious += computedPreviousWithTerm;
        summaryTotalCurrent += computedCurrent;
        summaryTotalAll += studentTotalOutstanding;
        uniqueClassesWithDebtors.add(currentClass);
      }
    }

    return res.status(200).json({
      success: true,
      metrics: {
        totalDebtorsCount: debtors.length,
        totalPreviousOutstanding: summaryTotalPrevious,
        totalCurrentOutstanding: summaryTotalCurrent,
        totalOutstandingAll: summaryTotalAll,
        classesWithDebtorsCount: uniqueClassesWithDebtors.size
      },
      debtors
    });
  } catch (error) {
    console.error("💥 Debtors list collection fault:", error);
    return res.status(500).json({ success: false, message: "Error compiling debtors summary records." });
  }
};

// @desc Fetch report datasets safe for PDF rendering
// @route GET /api/finance/debtors/export-pdf
export const getDebtorsPdfData = async (req, res) => {
  try {
    const { session, term } = req.query;

    const systemSettings = await SystemConfig.findOne({});
    const targetSession = session || systemSettings?.currentSession || "2026/2027";
    const targetTerm = term || systemSettings?.currentTerm || "First Term";

    const students = await Student.find({ status: { $in: ['Active', 'active', null] } }).lean();
    const allStructures = await FeeStructure.find({}).lean();
    const currentTermStructures = allStructures.filter(f => f.session === targetSession && f.term === targetTerm);

    let grandTotalPrevious = 0;
    let grandTotalCurrent = 0;
    let grandTotalSchool = 0;
    
    let classGroups = {};

    for (const student of students) {
      const isEnrolledInTargetTerm = isStudentEnrolledInTerm(student, targetSession, targetTerm);

      const currentClass = student.currentClass || student.assignedClass || "JSS 1";
      const normalizedClass = normalizeClassName(currentClass);

      const admittedSession = String(student.intakeSession || student.admittedSession || student.admissionSession || student.academicSession || '').trim();

      const adjustments = await Adjustment.find({ studentId: student._id }).lean();
      const adjustmentCredits = adjustments.filter(adj => adj.type === 'Discount' || adj.type === 'Waiver');
      const adjustmentIncreases = adjustments.filter(adj => adj.type === 'Fee Increase');

      const totalDiscountsWaivers = adjustmentCredits.reduce((sum, adj) => sum + adj.amount, 0);

      let pastExpectations = 0;
      allStructures.forEach(struct => {
        if (normalizeClassName(struct.className) === normalizedClass && isOlderTerm(struct.session, struct.term, targetSession, targetTerm)) {
          
          if (!isStudentEnrolledInTerm(student, struct.session, struct.term)) {
            return;
          }

          const studentType = admittedSession === struct.session ? 'New Students' : 'Returning Students';
          
          struct.items.forEach(item => {
            if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
              pastExpectations += Number(item.amount) || 0;
            }
          });

          const termIncreases = adjustmentIncreases.filter(adj => adj.session === struct.session && adj.term === struct.term);
          termIncreases.forEach(adj => {
            pastExpectations += adj.amount;
          });
        }
      });

      let currentTermExpectedFee = 0;
      if (isEnrolledInTargetTerm) {
        const matchingCurrentStructure = currentTermStructures.find(f => normalizeClassName(f.className) === normalizedClass);
        if (matchingCurrentStructure?.items) {
          const studentType = admittedSession === targetSession ? 'New Students' : 'Returning Students';
          
          matchingCurrentStructure.items.forEach(item => {
            if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
              currentTermExpectedFee += Number(item.amount) || 0;
            }
          });
        }

        const currentIncreases = adjustmentIncreases.filter(adj => adj.session === targetSession && adj.term === targetTerm);
        currentIncreases.forEach(adj => {
          currentTermExpectedFee += adj.amount;
        });
      }

      const matchingCurrentStructure = currentTermStructures.find(f => normalizeClassName(f.className) === normalizedClass);
      const isStructureActive = matchingCurrentStructure?.status === 'Active' || matchingCurrentStructure?.status === 'active';

      const payments = await Payment.find({ studentId: student._id, status: 'Successful' }).lean();
      const grandTotalPaid = payments.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
      const basePreviousOutstanding = Number(student.previousOutstanding) || 0;

      let totalDebtToResolve = basePreviousOutstanding + pastExpectations;
      let remainingPaymentCredit = grandTotalPaid + totalDiscountsWaivers;

      let computedPrevious = Math.max(0, totalDebtToResolve - remainingPaymentCredit);
      remainingPaymentCredit = Math.max(0, remainingPaymentCredit - totalDebtToResolve);

      let computedCurrentTermOutstanding = Math.max(0, currentTermExpectedFee - remainingPaymentCredit);

      let computedCurrent = 0;
      let computedPreviousWithTerm = computedPrevious;

      if (isStructureActive) {
        computedCurrent = computedCurrentTermOutstanding;
      } else {
        computedPreviousWithTerm += computedCurrentTermOutstanding;
      }

      let studentTotalOutstanding = computedPreviousWithTerm + computedCurrent;

      if (studentTotalOutstanding > 0) {
        const computedName = resolveStudentName(student);

        if (!classGroups[currentClass]) {
          classGroups[currentClass] = {
            className: currentClass,
            students: [],
            subtotalPrevious: 0,
            subtotalCurrent: 0,
            subtotalTotal: 0
          };
        }

        classGroups[currentClass].students.push({
          studentName: computedName,
          admissionNo: student.admissionNo || "N/A",
          previousOutstanding: computedPreviousWithTerm,
          currentOutstanding: computedCurrent,
          totalOutstanding: studentTotalOutstanding
        });

        classGroups[currentClass].subtotalPrevious += computedPreviousWithTerm;
        classGroups[currentClass].subtotalCurrent += computedCurrent;
        classGroups[currentClass].subtotalTotal += studentTotalOutstanding;

        grandTotalPrevious += computedPreviousWithTerm;
        grandTotalCurrent += computedCurrent;
        grandTotalSchool += studentTotalOutstanding;
      }
    }

    return res.status(200).json({
      success: true,
      academicSession: targetSession,
      academicTerm: targetTerm,
      generatedAtDate: new Date().toLocaleDateString('en-GB'),
      grandTotals: {
        grandTotalPrevious,
        grandTotalCurrent,
        grandTotalSchool
      },
      reportData: Object.values(classGroups)
    });
  } catch (error) {
    console.error("💥 PDF Pipeline data gathering failed:", error);
    return res.status(500).json({ success: false, message: "Error compiling report records." });
  }
};