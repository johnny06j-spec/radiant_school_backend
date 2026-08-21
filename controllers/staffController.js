// controllers/staffController.js
import User from '../models/User.js';
import ResultReview from '../models/ResultReview.js';
import Student from '../models/Student.js';
import GradingGrid from '../models/GradingGrid.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const getSessionYearPrefix = (sessionStr) => {
  if (!sessionStr) return "26";
  const match = sessionStr.match(/^(\d{4})/);
  return match ? match[1].slice(-2) : "26";
};

/**
 * Helper to calculate section-aware letter grades
 */
const calculateGrade = (score, section = 'PRIMARY') => {
  const numScore = Number(score) || 0;

  if (section.toUpperCase() === 'PRIMARY') {
    if (numScore >= 86) return 'A';
    if (numScore >= 70) return 'B';
    if (numScore >= 50) return 'C';
    if (numScore >= 45) return 'D';
    if (numScore >= 40) return 'E';
    return 'F';
  } else {
    // SECONDARY
    if (numScore >= 90) return 'A*';
    if (numScore >= 70) return 'A';
    if (numScore >= 60) return 'B';
    if (numScore >= 50) return 'C';
    if (numScore >= 40) return 'D';
    if (numScore >= 30) return 'E';
    return 'F';
  }
};

/**
 * @route   POST /api/teachers/register
 * @desc    Provision new instructor / HM / Principal profile
 */
export const registerStaff = async (req, res) => {
  try {
    const { 
      surname, firstName, name, email, phone, schoolSection, 
      assignedClass, department, subjectAllocations, username, 
      password, isClassTeacher, classTeacherOf, role = 'teacher' 
    } = req.body;

    const targetSurname = surname ? surname.trim() : '';
    const targetFirstName = firstName ? firstName.trim() : '';
    const fullName = name ? name.trim() : `${targetSurname} ${targetFirstName}`.trim();

    if (!fullName || !email) {
      return res.status(400).json({ success: false, message: "Please fill out required core fields." });
    }

    const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingEmail) {
      return res.status(400).json({ success: false, message: "This email address is already registered to another staff member." });
    }

    let assignedRole = ['teacher', 'headmaster', 'principal'].includes(role) ? role : 'teacher';

    let finalUsername = username ? username.trim() : null;
    if (!finalUsername) {
      if (targetFirstName && targetSurname) {
        const cleanFirst = targetFirstName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanSur = targetSurname.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3);
        finalUsername = `${cleanFirst}.${cleanSur}`;
      } else {
        const yearPrefix = getSessionYearPrefix(new Date().getFullYear().toString());
        const randomNumericSuffix = Math.floor(1000 + crypto.randomInt(0, 9000));
        let prefix = 'STF';
        if (assignedRole === 'headmaster') prefix = 'HM';
        if (assignedRole === 'principal') prefix = 'PRN';
        finalUsername = `${prefix}/${yearPrefix}/${randomNumericSuffix}`;
      }
    }

    const existingUsername = await User.findOne({ username: finalUsername });
    if (existingUsername) {
      finalUsername = `${finalUsername}${Math.floor(100 + Math.random() * 900)}`;
    }

    let plainPassword = password || `Tch@${Math.floor(1000 + Math.random() * 9000)}`;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

    const isExec = assignedRole === 'headmaster' || assignedRole === 'principal' || department === 'Executive Administration';
    const activeSection = schoolSection || 'PRIMARY';
    
    const finalIsClassTeacher = isExec ? false : (activeSection === 'PRIMARY' ? true : Boolean(isClassTeacher));
    const finalClassTeacherOf = isExec ? '' : (activeSection === 'PRIMARY' ? (assignedClass || 'KG 1').trim() : (finalIsClassTeacher ? (classTeacherOf || '').trim() : ''));
    const computedAllocations = isExec ? [] : (activeSection === 'SECONDARY' ? (Array.isArray(subjectAllocations) ? subjectAllocations : []) : [{ className: assignedClass || 'KG 1', subjectName: 'CLASS TEACHER' }]);

    const newStaff = await User.create({
      name: fullName,
      surname: targetSurname,
      firstName: targetFirstName,
      email: email.toLowerCase().trim(),
      username: finalUsername,
      password: hashedPassword,
      role: assignedRole,
      phone: phone ? phone.trim() : '',
      schoolSection: activeSection,
      department: isExec ? 'Executive Administration' : (department || 'General'),
      assignedClass: isExec ? 'N/A' : (activeSection === 'PRIMARY' ? (assignedClass || 'KG 1') : 'N/A'),
      isClassTeacher: finalIsClassTeacher,
      classTeacherOf: finalClassTeacherOf,
      subjectAllocations: computedAllocations,
      status: 'Active',
      isActive: true
    });

    return res.status(201).json({
      success: true,
      message: "Staff account provisioned successfully.",
      staff: {
        id: newStaff._id,
        name: newStaff.name,
        email: newStaff.email,
        username: newStaff.username,
        role: newStaff.role,
        isClassTeacher: newStaff.isClassTeacher,
        classTeacherOf: newStaff.classTeacherOf
      },
      credentials: {
        username: finalUsername,
        temporaryPassword: plainPassword
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route   PUT /api/teachers/:id
 * @desc    Update staff profile
 */
export const updateStaff = async (req, res) => {
  try {
    const staffId = req.params.id;
    const { 
      surname, firstName, name, email, phone, schoolSection, 
      assignedClass, department, subjectAllocations, isClassTeacher, 
      classTeacherOf, role, password 
    } = req.body;

    const staffUser = await User.findById(staffId);
    if (!staffUser) {
      return res.status(404).json({ success: false, message: "Target staff profile not found." });
    }

    let updateFields = {};

    const targetSurname = surname !== undefined ? surname.trim() : staffUser.surname;
    const targetFirstName = firstName !== undefined ? firstName.trim() : staffUser.firstName;
    
    if (surname !== undefined) updateFields.surname = targetSurname;
    if (firstName !== undefined) updateFields.firstName = targetFirstName;

    if (name) {
      updateFields.name = name.trim();
    } else if (surname !== undefined || firstName !== undefined) {
      updateFields.name = `${targetSurname} ${targetFirstName}`.trim();
    }

    if (email && email.toLowerCase().trim() !== staffUser.email) {
      const emailExists = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: staffId } });
      if (emailExists) {
        return res.status(400).json({ success: false, message: "This email address is already registered to another staff member." });
      }
      updateFields.email = email.toLowerCase().trim();
    }

    if (phone !== undefined) updateFields.phone = phone.trim();
    if (department !== undefined) updateFields.department = department.trim();
    if (role !== undefined) updateFields.role = role;

    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password.trim(), salt);
    }

    const activeRole = role || staffUser.role;
    const isExec = activeRole === 'headmaster' || activeRole === 'principal' || (department && department.trim() === 'Executive Administration');
    const activeSection = schoolSection || staffUser.schoolSection || 'PRIMARY';
    
    updateFields.schoolSection = activeSection;

    if (isExec) {
      updateFields.assignedClass = 'N/A';
      updateFields.isClassTeacher = false;
      updateFields.classTeacherOf = '';
      updateFields.subjectAllocations = [];
      updateFields.department = 'Executive Administration';
    } else if (activeSection === 'PRIMARY') {
      const primaryClass = (assignedClass || staffUser.assignedClass || 'KG 1').trim();
      updateFields.assignedClass = primaryClass;
      updateFields.isClassTeacher = true;
      updateFields.classTeacherOf = primaryClass;
      updateFields.subjectAllocations = [{ className: primaryClass, subjectName: 'CLASS TEACHER' }];
    } else {
      updateFields.assignedClass = assignedClass ? assignedClass.trim() : (staffUser.assignedClass || 'N/A');
      updateFields.isClassTeacher = Boolean(isClassTeacher);
      updateFields.classTeacherOf = isClassTeacher ? (classTeacherOf || '').trim() : '';
      if (Array.isArray(subjectAllocations)) {
        updateFields.subjectAllocations = subjectAllocations;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      staffId,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: "Staff profile details saved successfully.",
      user: updatedUser
    });

  } catch (error) {
    console.error("💥 Error updating staff profile:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error updating staff details.", 
      error: error.message 
    });
  }
};

/**
 * @route   GET /api/teachers
 * @desc    Fetch list of all staff members
 */
export const getAllStaff = async (req, res) => {
  try {
    const staff = await User.find({ role: { $in: ['teacher', 'headmaster', 'principal'] } }).select('-password').sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, staff });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error fetching staff members.", error: error.message });
  }
};

/**
 * @route   DELETE /api/teachers/:id
 * @desc    Delete a staff user profile
 */
export const deleteStaff = async (req, res) => {
  try {
    const staffMember = await User.findById(req.params.id);
    if (!staffMember) return res.status(404).json({ success: false, message: 'Staff record not found.' });
    await User.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Staff profile purged successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to purge staff record.', error: error.message });
  }
};

/**
 * @route   GET /api/teachers/executive-reviews
 * @desc    Fetch pending/submitted/returned student result reviews for HM/Principal desk
 */
export const getExecutiveReviews = async (req, res) => {
  try {
    const { className, term, session, status } = req.query;

    let query = {};

    if (className) {
      const cleanClass = className.trim();
      const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');
      query.$or = [{ className: classRegex }, { class: classRegex }];
    }
    
    if (term) query.term = term.trim();
    if (session) query.session = session.trim();
    
    if (status) {
      const targetStatus = status.trim();
      
      if (targetStatus === 'Returned for Revision' || targetStatus === 'Returned') {
        query.status = { $in: ['Returned for Revision', 'Returned', 'Returned For Revision'] };
      } else if (targetStatus === 'Submitted for Review' || targetStatus === 'Submitted') {
        query.status = { $in: ['Submitted', 'Submitted for Review', 'Pending Executive Review'] };
      } else if (targetStatus === 'Approved by Executive' || targetStatus === 'Approved') {
        query.$or = [
          { status: /approved/i },
          { isApprovedByExecutive: true },
          { isApprovedByHM: true },
          { isApprovedByPrincipal: true }
        ];
      } else if (targetStatus === 'Released to Portals' || targetStatus === 'Released') {
        query.status = 'Released';
      } else {
        query.status = targetStatus;
      }
    }

    const reviews = await ResultReview.find(query).lean();

    const populatedReviews = await Promise.all(
      reviews.map(async (rev) => {
        const student = await Student.findById(rev.studentId).select('firstName surname name admissionNo passportPhoto currentClass').lean().catch(() => null);
        
        return {
          _id: rev.studentId || rev._id,
          reviewId: rev._id,
          name: student ? `${student.surname || ''} ${student.firstName || student.name || ''}`.trim() : (rev.name || rev.studentName || 'Student Record'),
          firstName: student?.firstName || rev.studentName?.split(' ')[0] || '',
          surname: student?.surname || rev.studentName?.split(' ').slice(1).join(' ') || '',
          admissionNo: student?.admissionNo || rev.admissionNo || 'N/A',
          passportPhoto: student?.passportPhoto || null,
          status: rev.status,
          className: rev.className || className,
          overallAverage: rev.overallAverage || 0,
          teacherRemark: rev.teacherRemark || '',
          rejectionReason: rev.rejectionReason || ''
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: populatedReviews
    });
  } catch (error) {
    console.error("💥 Error fetching executive reviews:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve executive review queue.",
      error: error.message
    });
  }
};

/**
 * @route   GET /api/teachers/review-single
 * @desc    Fetch single student detailed result card with robust prior-term B.F lookup
 */
export const getSingleStudentReview = async (req, res) => {
  try {
    const { studentId, className, term, session } = req.query;

    if (!studentId || !className || !term || !session) {
      return res.status(400).json({
        success: false,
        message: 'studentId, className, term, and session are required.'
      });
    }

    const PRIMARY_CLASSES = ['KG 1', 'KG 2', 'Nursery 1', 'Nursery 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5'];
    
    const cleanClass = className.trim();
    const isPrimary = PRIMARY_CLASSES.some(c => c.toLowerCase() === cleanClass.toLowerCase());
    const section = isPrimary ? 'PRIMARY' : 'SECONDARY';
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');

    const [studentDoc, reviewDoc, grids] = await Promise.all([
      Student.findById(studentId).lean().catch(() => null),
      ResultReview.findOne({
        studentId,
        $or: [{ className: classRegex }, { class: classRegex }],
        term: term.trim(),
        session: session.trim()
      }).lean(),
      GradingGrid.find({
        className: classRegex,
        term: term.trim(),
        session: session.trim()
      }).lean()
    ]);

    // 🟢 Robust Previous Term B.F Scores Lookup
    let prevScoresMap = {};
    const normalizedTerm = term.trim().toUpperCase();

    if (normalizedTerm !== 'FIRST TERM') {
      let priorTermRegex = normalizedTerm.includes('THIRD') ? /second|2nd/i : /first|1st/i;

      const priorGrids = await GradingGrid.find({
        className: classRegex,
        term: priorTermRegex,
        session: session.trim()
      }).lean();

      priorGrids.forEach(pg => {
        const match = pg.studentsScores?.find(s => 
          (s.studentId && s.studentId.toString() === studentId.toString()) ||
          (studentDoc?.admissionNo && s.admissionNo && s.admissionNo.toString().trim().toUpperCase() === studentDoc.admissionNo.toString().trim().toUpperCase())
        );
        if (match) {
          const score = Number(match.averageScore ?? match.totalScore) || (
            (Number(match.ca1) || 0) + (Number(match.ca2) || 0) + (Number(match.exam) || 0)
          );
          if (pg.subjectName) {
            prevScoresMap[pg.subjectName.trim().toUpperCase()] = score;
          }
        }
      });
    }

    let totalSum = 0;
    let subjectCount = 0;

    const subjects = grids.map(grid => {
      const cell = grid.studentsScores?.find(
        s => (s.studentId || s._id || s.id || '').toString() === studentId.toString() ||
             (s.admissionNo && studentDoc?.admissionNo && s.admissionNo.toString().toUpperCase() === studentDoc.admissionNo.toString().toUpperCase())
      );

      const ca1 = Number(cell?.ca1) || 0;
      const ca2 = Number(cell?.ca2) || 0;
      const proj = Number(cell?.project) || 0;
      const exam = Number(cell?.exam) || 0;
      const totalScore = Number(cell?.totalScore) || (ca1 + ca2 + proj + exam);

      const subKey = (grid.subjectName || grid.subject || '').trim().toUpperCase();
      let bf = Number(cell?.broughtForward) || prevScoresMap[subKey] || 0;

      const averageScore = (normalizedTerm !== 'FIRST TERM' && bf > 0) ? Math.round(((totalScore + bf) / 2) * 100) / 100 : totalScore;

      totalSum += averageScore;
      subjectCount++;

      return {
        subject: grid.subjectName || grid.subject || 'Subject',
        ca1,
        ca2,
        project: proj,
        exam,
        totalScore,
        broughtForward: bf,
        averageScore,
        grade: calculateGrade(averageScore, section)
      };
    });

    const calculatedAvg = subjectCount > 0 ? Math.round((totalSum / subjectCount) * 100) / 100 : (reviewDoc?.overallAverage || 0);

    return res.status(200).json({
      success: true,
      data: {
        student: studentDoc || { _id: studentId, name: reviewDoc?.name || 'Student' },
        review: reviewDoc || {},
        subjects,
        overallAverage: calculatedAvg,
        subjectCount,
        section
      }
    });

  } catch (error) {
    console.error("💥 Error fetching single student review:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load student result card details.",
      error: error.message
    });
  }
};