// controllers/studentController.js
import Student from '../models/Student.js';
import User from '../models/User.js';
import FeeStructure from '../models/FeeStructure.js';
import Payment from '../models/Payment.js';
import SystemConfig from '../models/SystemConfig.js';
import Adjustment from '../models/Adjustment.js';
import ResultReview from '../models/ResultReview.js';
import bcrypt from 'bcryptjs';

/**
 * Helper to extract the starting year from a session string (e.g., "2026/2027" -> 2026)
 */
const getSessionStartYear = (sessionStr) => {
  if (!sessionStr) return 0;
  const match = sessionStr.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Helper to determine term chronological weight
 */
const getTermOrder = (termName) => {
  if (!termName) return 0;
  const normalized = termName.trim().toLowerCase();
  if (normalized.includes('first') || normalized.includes('1st')) return 1;
  if (normalized.includes('second') || normalized.includes('2nd')) return 2;
  if (normalized.includes('third') || normalized.includes('3rd')) return 3;
  return 0;
};

/**
 * Helper to normalize common Roman numeral variations and class formats to match fee templates
 */
const normalizeClassName = (className) => {
  if (!className) return "";
  let normalized = className.trim().toUpperCase();
  return normalized
    .replace(/\bKG\s*I\b/g, 'KG 1')
    .replace(/\bKG\s*II\b/g, 'KG 2')
    .replace(/\bKG\s*III\b/g, 'KG 3')
    .replace(/\bPRIMARY\s*/g, 'BASIC ')
    .replace(/\bGRADE\s*/g, 'BASIC ')
    .replace(/\bJSS\s*I\b/g, 'JSS 1')
    .replace(/\bJSS\s*II\b/g, 'JSS 2')
    .replace(/\bJSS\s*III\b/g, 'JSS 3')
    .replace(/\bSSS\s*I\b/g, 'SSS 1')
    .replace(/\bSSS\s*II\b/g, 'SSS 2')
    .replace(/\bSSS\s*III\b/g, 'SSS 3');
};

/**
 * Determine if a term/session is older than the target term/session
 */
const isOlderTerm = (compSession, compTerm, targetSession, targetTerm) => {
  if (compSession === targetSession && compTerm === targetTerm) return false;
  
  const compYear = getSessionStartYear(compSession);
  const targetYear = getSessionStartYear(targetSession);

  if (compYear !== targetYear) {
    return compYear < targetYear;
  }

  return getTermOrder(compTerm) < getTermOrder(targetTerm);
};

/**
 * Helper to fetch System Config from the Database.
 */
const getSystemConfig = async () => {
  try {
    const config = await SystemConfig.findOne({}).sort({ createdAt: -1 });
    if (!config) {
      return { currentSession: "2026/2027", currentTerm: "First Term" };
    }
    return {
      currentSession: config.currentSession,
      currentTerm: config.currentTerm
    };
  } catch (err) {
    console.error("⚠️ Error fetching SystemConfig model. Falling back:", err);
    return { currentSession: "2026/2027", currentTerm: "First Term" };
  }
};

/**
 * Sort function to order structures chronologically
 */
const compareStructuresChronologically = (a, b) => {
  const yearA = getSessionStartYear(a.session);
  const yearB = getSessionStartYear(b.session);
  if (yearA !== yearB) return yearA - yearB;
  return getTermOrder(a.term) - getTermOrder(b.term);
};

/**
 * @route   POST /api/students/link-sibling
 * @desc    Link a sibling student profile using Admission Number/Username & Password
 * @access  Private (Student)
 */
export const linkSibling = async (req, res) => {
  try {
    const currentStudentId = req.user.id;
    const { admissionNo, password } = req.body;

    if (!admissionNo || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Admission Number and Password are required." 
      });
    }

    const cleanedRef = admissionNo.trim();

    const currentStudent = await Student.findOne({
      $or: [{ _id: currentStudentId }, { user: currentStudentId }]
    });

    if (!currentStudent) {
      return res.status(404).json({
        success: false,
        message: "Your current student profile was not found."
      });
    }

    const targetSibling = await Student.findOne({
      $or: [
        { admissionNo: new RegExp(`^${cleanedRef}$`, 'i') },
        { admissionCode: new RegExp(`^${cleanedRef}$`, 'i') },
        { username: new RegExp(`^${cleanedRef}$`, 'i') }
      ]
    })
    .select('+password')
    .populate({
      path: 'user',
      select: '+password'
    });

    if (!targetSibling) {
      return res.status(404).json({ 
        success: false, 
        message: "No student account found matching this Admission Number / Username." 
      });
    }

    if (
      targetSibling._id.toString() === currentStudent._id.toString() ||
      (targetSibling.user && targetSibling.user._id.toString() === currentStudent.user?.toString())
    ) {
      return res.status(400).json({ 
        success: false, 
        message: "This account is already your current active profile." 
      });
    }

    let isMatch = false;
    if (targetSibling.password) {
      isMatch = await bcrypt.compare(password, targetSibling.password);
    }

    if (!isMatch && targetSibling.user && targetSibling.user.password) {
      isMatch = await bcrypt.compare(password, targetSibling.user.password);
    }

    if (!isMatch) {
      if (
        targetSibling.password === password ||
        (targetSibling.user && targetSibling.user.password === password)
      ) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication failed. Incorrect password for the target student." 
      });
    }

    await Student.findByIdAndUpdate(currentStudent._id, {
      $addToSet: { linkedSiblings: targetSibling._id }
    });

    await Student.findByIdAndUpdate(targetSibling._id, {
      $addToSet: { linkedSiblings: currentStudent._id }
    });

    const updatedStudent = await Student.findById(currentStudent._id)
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto');

    return res.status(200).json({
      success: true,
      message: `${targetSibling.firstName || targetSibling.name || 'Sibling'}'s account linked successfully!`,
      linkedSiblings: updatedStudent.linkedSiblings || []
    });

  } catch (error) {
    console.error("💥 Sibling account linking exception:", error);
    return res.status(500).json({
      success: false,
      message: "Server error occurred while linking sibling account.",
      error: error.message
    });
  }
};

/**
 * @route   POST /api/students/unlink-sibling
 * @desc    Unlink a sibling profile from the student's portal
 * @access  Private (Student)
 */
export const unlinkSibling = async (req, res) => {
  try {
    const { siblingId } = req.body;
    const currentStudentId = req.user.id;

    if (!siblingId) {
      return res.status(400).json({ success: false, message: "Sibling ID parameter is required." });
    }

    const currentStudent = await Student.findOne({
      $or: [{ _id: currentStudentId }, { user: currentStudentId }]
    });

    if (!currentStudent) {
      return res.status(404).json({ success: false, message: "Current student account context not found." });
    }

    await Student.findByIdAndUpdate(currentStudent._id, {
      $pull: { linkedSiblings: siblingId }
    });

    await Student.findByIdAndUpdate(siblingId, {
      $pull: { linkedSiblings: currentStudent._id }
    });

    const updatedStudent = await Student.findById(currentStudent._id)
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto');

    return res.status(200).json({
      success: true,
      message: "Sibling account successfully unlinked.",
      linkedSiblings: updatedStudent.linkedSiblings || []
    });
  } catch (error) {
    console.error("💥 Unlink sibling exception:", error);
    return res.status(500).json({
      success: false,
      message: "Server error occurred while unlinking sibling account.",
      error: error.message
    });
  }
};

/**
 * @route   GET /api/students/profile/me
 * @desc    Fetch profile dashboard data for current student (or targeted student via req.query.studentId)
 * @access  Private (Student)
 */
export const getStudentProfile = async (req, res) => {
  try {
    const targetId = req.query.studentId || req.params.id;
    let query = targetId ? { _id: targetId } : { user: req.user.id };

    let student = await Student.findOne(query)
      .populate('user', 'firstName lastName name email')
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto');

    if (!student && !targetId) {
      student = await Student.findById(req.user.id)
        .populate('user', 'firstName lastName name email')
        .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto');
    }

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: "Isolated student dataset record not found." 
      });
    }

    // 1. ALWAYS use SystemConfig values dynamically
    const systemConfig = await getSystemConfig();
    const currentSession = systemConfig.currentSession;
    const currentTerm = systemConfig.currentTerm;

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

    // Fetch all adjustments and result reviews for accurate historical resolution
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

    // 2. Fetch and sort ALL structures to calculate past expectations chronologically
    const allStructures = await FeeStructure.find({}).lean();
    allStructures.sort(compareStructuresChronologically);
    
    let historicalFeeItemsBreakdown = []; 

    allStructures.forEach(struct => {
      if (isOlderTerm(struct.session, struct.term, currentSession, currentTerm)) {
        const historicalClass = resolveClassForTerm(struct.session, struct.term);
        if (normalizeClassName(struct.className) === normalizeClassName(historicalClass)) {
          const structTermWeight = getTermOrder(struct.term);
          if (actualAdmissionSession && struct.session === actualAdmissionSession && structTermWeight > 0 && structTermWeight < admittedTermWeight) {
            return; // Skip terms prior to student enrollment
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

    // 3. Current Active Term Fee Structure
    const currentClassContext = resolveClassForTerm(currentSession, currentTerm);
    const studentNormalizedClass = normalizeClassName(currentClassContext);

    const currentStructure = allStructures.find(struct => 
      normalizeClassName(struct.className) === studentNormalizedClass &&
      struct.session === currentSession &&
      new RegExp(`^${currentTerm.trim()}$`, 'i').test(struct.term?.trim() || '')
    );

    const isStructureActive = currentStructure?.status === 'Active' || currentStructure?.status === 'active';

    let rawCurrentTermFee = 0;
    let currentPersonalizedItems = []; 
    let currentStudentType = actualAdmissionSession === currentSession ? 'New Students' : 'Returning Students';

    if (currentStructure) {
      const activeItems = currentStructure.items.filter(item => 
        item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === currentStudentType)
      );
      
      currentPersonalizedItems = activeItems.map(item => ({
        name: item.name,
        amount: Number(item.amount) || 0,
        appliesTo: item.appliesTo
      }));

      const currentIncreases = adjustmentIncreases.filter(adj => adj.session === currentSession && new RegExp(`^${currentTerm.trim()}$`, 'i').test(adj.term?.trim() || ''));
      currentIncreases.forEach(adj => {
        currentPersonalizedItems.push({
          name: `[Fee Increase] ${adj.reason}`,
          amount: Number(adj.amount) || 0,
          appliesTo: currentStudentType
        });
      });

      rawCurrentTermFee = currentPersonalizedItems.reduce((sum, item) => sum + item.amount, 0);
    }

    // 🟢 4. Fetch ALL successful payments sorted chronologically without term restrictions
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

    // 5. Re-aggregate financial metrics
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

    return res.status(200).json({
      success: true,
      student: {
        _id: student._id,
        firstName: student.firstName || student.user?.firstName || student.user?.name?.split(' ')[0] || "Student",
        lastName: student.surname || student.lastName || student.user?.lastName || student.user?.name?.split(' ')[1] || "",
        email: student.email || student.user?.email || "N/A",
        admissionNo: student.admissionNo || student.admissionCode || "N/A",
        dob: student.dob || "N/A", 
        gender: student.gender || "N/A",
        admissionSession: actualAdmissionSession,
        admissionTerm: actualAdmissionTerm,
        academicSession: currentSession, 
        academicTerm: currentTerm,       
        currentClass: student.currentClass || "N/A", // 🟢 STRICT: Never overridden by ResultReview
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
      message: "Server error retrieving profile dashboard metrics.", 
      error: error.message 
    });
  }
};

/**
 * @route   GET /api/students
 * @desc    Fetch list of all enrolled students
 * @access  Private (Admin/Staff)
 */
export const getAllStudents = async (req, res) => {
  try {
    const { search, assignedClass, intakeSession } = req.query;
    let query = {};

    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { surname: searchRegex },
        { firstName: searchRegex },
        { otherName: searchRegex },
        { admissionNo: searchRegex }
      ];
    }

    if (assignedClass && assignedClass !== 'All Classes') {
      query.$or = [
        { currentClass: assignedClass },
        { assignedClass: assignedClass }
      ];
    }

    if (intakeSession && intakeSession !== 'All Sessions') {
      query.$or = [
        { admittedSession: intakeSession },
        { admissionSession: intakeSession },
        { academicSession: intakeSession }
      ];
    }

    const students = await Student.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: students.length,
      students
    });
  } catch (error) {
    console.error("💥 Student directory fetch exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error gathering student directory records.", 
      error: error.message 
    });
  }
};

/**
 * @route   GET /api/students/:id
 * @desc    Get a single student's complete profile parameters
 * @access  Private (Admin)
 */
export const getStudentById = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student operational record not found.' });
    }
    
    return res.status(200).json({
      success: true,
      student
    });
  } catch (error) {
    console.error("💥 Student profile parameter retrieval exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error retrieving profile details.', 
      error: error.message 
    });
  }
};

/**
 * @route   PUT /api/students/:id
 * @desc    Update an existing student
 * @access  Private (Admin)
 */
export const updateStudent = async (req, res) => {
  try {
    const studentId = req.params.id;
    let updateData = { ...req.body };

    const systemConfig = await getSystemConfig();

    if (req.body.firstName || req.body.surname) {
      const currentStudent = await Student.findById(studentId);
      if (currentStudent) {
        const first = req.body.firstName || currentStudent.firstName;
        const sur = req.body.surname || currentStudent.surname;
        const other = req.body.otherName !== undefined ? req.body.otherName : currentStudent.otherName;
        updateData.name = `${first.trim()} ${sur.trim()} ${other ? other.trim() : ''}`.replace(/\s+/g, ' ').trim();
      }
    }

    if (req.body.gender) {
      updateData.gender = req.body.gender.trim();
    }

    if (req.file && req.file.path) {
      updateData.passportPhoto = req.file.path;
    }

    if (!updateData.admissionTerm && !updateData.admittedTerm) {
      updateData.admissionTerm = systemConfig.currentTerm;
      updateData.admittedTerm = systemConfig.currentTerm;
    }

    const updatedStudent = await Student.findByIdAndUpdate(
      studentId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedStudent) {
      return res.status(404).json({ success: false, message: "Student record mutation targeted a non-existent ID." });
    }

    if (updatedStudent.user) {
      await User.findByIdAndUpdate(updatedStudent.user, {
        $set: {
          name: updatedStudent.name,
          email: updatedStudent.email.toLowerCase().trim()
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: "Student profile saved and database records synchronized successfully.",
      student: updatedStudent
    });
  } catch (error) {
    console.error("💥 Backend student record update mutation exception:", error);
    return res.status(500).json({ success: false, message: "Internal server update error.", error: error.message });
  }
};

/**
 * @route   DELETE /api/students/:id
 * @desc    Permanently delete a student document
 * @access  Private (Admin)
 */
export const deleteStudent = async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: "Target student record not found." });
    }

    if (student.user) {
      await User.findByIdAndDelete(student.user);
    }

    await Student.findByIdAndDelete(studentId);

    return res.status(200).json({
      success: true,
      message: "Student record cleanly purged."
    });
  } catch (error) {
    console.error("💥 Backend student deletion pipeline exception:", error);
    return res.status(500).json({ success: false, message: "Internal server deletion error.", error: error.message });
  }
};

/**
 * @route   PUT /api/system/config
 * @desc    Update global academic session settings and execute academic rollover
 * @access  Private (Admin Only)
 */
export const updateSystemConfig = async (req, res) => {
  try {
    const { currentSession, currentTerm } = req.body;

    if (!currentSession || !currentTerm) {
      return res.status(400).json({
        success: false,
        message: "Please provide both currentSession and currentTerm."
      });
    }

    const previousConfig = await SystemConfig.findOne({}).sort({ createdAt: -1 }).lean();
    const isNewSession = previousConfig && previousConfig.currentSession !== currentSession;

    const updatedConfig = await SystemConfig.findOneAndUpdate(
      {}, 
      { 
        $set: { 
          currentSession, 
          currentTerm 
        } 
      },
      { new: true, upsert: true }
    );

    let promotedCount = 0;

    // 🟢 ACADEMIC ROLLOVER: Run promotion transitions ONLY when the academic session changes
    if (isNewSession) {
      const oldSession = previousConfig.currentSession;

      // Find all approved Third Term reviews from the old session
      const approvedReviews = await ResultReview.find({
        session: oldSession,
        term: /third/i,
        $or: [
          { isApprovedByExecutive: true },
          { isApprovedByPrincipal: true },
          { status: /approved|released|published/i }
        ]
      }).lean();

      for (const rev of approvedReviews) {
        if (rev.promotionDecision === 'PROMOTED' && rev.promotedToClass) {
          await Student.findByIdAndUpdate(rev.studentId, {
            $set: {
              currentClass: rev.promotedToClass,
              assignedClass: rev.promotedToClass,
              academicSession: currentSession,
              academicTerm: currentTerm,
              enrollmentType: 'Returning Student'
            }
          });
          promotedCount++;
        } else if (rev.promotionDecision === 'REPEAT') {
          await Student.findByIdAndUpdate(rev.studentId, {
            $set: {
              academicSession: currentSession,
              academicTerm: currentTerm,
              enrollmentType: 'Returning Student'
            }
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: isNewSession 
        ? `Academic rollover to ${currentSession} completed. Processed ${promotedCount} promotions.`
        : `Academic settings updated to ${currentTerm} (${currentSession}).`,
      config: updatedConfig
    });
  } catch (error) {
    console.error("💥 System configuration update exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error updating system configurations.", 
      error: error.message 
    });
  }
};