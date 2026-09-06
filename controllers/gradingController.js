// controllers/gradingController.js
import Student from '../models/Student.js';
import GradingGrid from '../models/GradingGrid.js';
import FeeStructure from '../models/FeeStructure.js';
import Payment from '../models/Payment.js';
import Adjustment from '../models/Adjustment.js';
import ResultReview from '../models/ResultReview.js';

const normalizeName = (nameStr) => {
  if (!nameStr) return '';
  return nameStr.toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * @route   GET /api/teachers/fetch-grid
 * @desc    Fetch grading grid sheet and sync against live student roster (purges deleted students)
 * @access  Private (Teacher/Staff)
 */
export const fetchGradingGrid = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const { className, subjectName, term, session } = req.query;

    if (!className || !subjectName) {
      return res.status(400).json({
        success: false,
        message: "Missing className or subjectName query parameters."
      });
    }

    const cleanClass = className.trim();
    const cleanSubject = subjectName.trim();
    const classPattern = cleanClass.replace(/\s+/g, '\\s*');
    const classRegex = new RegExp(`^${classPattern}$`, 'i');

    // 1. Calculate Previous Term for Brought Forward (BF) Scores
    let previousTerm = null;
    if (term === 'Second Term') previousTerm = 'First Term';
    if (term === 'Third Term') previousTerm = 'Second Term';

    let prevScoreById = {};
    let prevScoreByName = {};

    if (previousTerm) {
      const prevGrid = await GradingGrid.findOne({
        className: classRegex,
        subjectName: new RegExp(`^${cleanSubject.replace(/\s+/g, '\\s*')}$`, 'i'),
        term: previousTerm,
        session
      }).lean();

      if (prevGrid && prevGrid.studentsScores) {
        prevGrid.studentsScores.forEach(s => {
          const scoreVal = Number(s.averageScore ?? s.totalScore) || 0;
          
          if (s.studentId) prevScoreById[s.studentId.toString()] = scoreVal;
          if (s.admissionNo) prevScoreById[s.admissionNo.toString().trim().toUpperCase()] = scoreVal;
          if (s.name) prevScoreByName[normalizeName(s.name)] = scoreVal;
        });
      }
    }

    const resolveBF = (studentId, admissionNo, name) => {
      const cleanId = studentId ? studentId.toString() : '';
      const cleanAdm = admissionNo ? admissionNo.toString().trim().toUpperCase() : '';
      const cleanName = normalizeName(name);

      return prevScoreById[cleanId] ?? prevScoreById[cleanAdm] ?? prevScoreByName[cleanName] ?? 0;
    };

    // 2. Fetch Live Active Students Enrolled strictly in this Class
    const currentEnrolledStudents = await Student.find({
      $or: [
        { currentClass: classRegex },
        { assignedClass: classRegex },
        { className: classRegex },
        { class: classRegex }
      ]
    }).sort({ surname: 1, firstname: 1, firstName: 1, name: 1 }).lean();

    // Build fast lookup sets for active students
    const activeStudentIds = new Set(currentEnrolledStudents.map(s => s._id.toString()));
    const activeAdmissions = new Set(
      currentEnrolledStudents
        .map(s => (s.admissionNo || s.registrationNo || '').toString().trim().toUpperCase())
        .filter(Boolean)
    );
    const activeNormalizedNames = new Set(
      currentEnrolledStudents.map(s => normalizeName(s.name || `${s.surname || ''} ${s.firstname || s.firstName || ''}`))
    );

    // 🟢 LOCK CHECK MUST BE STRICTLY SCOPED TO EXACT className, subjectName, term, AND session
    let grid = await GradingGrid.findOne({
      className: classRegex,
      subjectName: new RegExp(`^${cleanSubject.replace(/\s+/g, '\\s*')}$`, 'i'),
      term: term.trim(),
      session: session.trim()
    });

    // 3. Initialize or Sync Grid
    if (!grid || !grid.studentsScores || grid.studentsScores.length === 0) {
      // Fresh Grid for Active Students Only
      const studentsScores = currentEnrolledStudents.map(student => {
        const studentFullName = student.name 
          ? student.name 
          : `${student.surname || student.lastName || ''} ${student.firstname || student.firstName || ''}`.trim();

        const autoBF = resolveBF(student._id, student.admissionNo, studentFullName);

        return {
          studentId: student._id,
          admissionNo: student.admissionNo || student.registrationNo || student._id.toString().slice(-6),
          name: studentFullName || 'Unnamed Student',
          ca1: 0, ca2: 0, project: 0, exam: 0, totalScore: 0,
          broughtForward: autoBF,
          averageScore: Math.round((autoBF / 2) * 100) / 100,
          grade: 'F', remark: 'FAIL'
        };
      });

      grid = {
        className: cleanClass,
        subjectName: cleanSubject,
        term,
        session,
        status: 'Draft',
        studentsScores
      };
    } else {
      grid = grid.toObject();
      const seenIds = new Set();
      const uniqueSavedScores = [];

      // STEP A: Keep only saved score rows belonging to STILL-EXISTING active students
      grid.studentsScores.forEach(row => {
        const rowIdStr = (row.studentId || row.id || '').toString();
        const rowAdmStr = (row.admissionNo || '').toString().trim().toUpperCase();
        const rowNormName = normalizeName(row.name || '');

        const isStillEnrolled = 
          (rowIdStr && activeStudentIds.has(rowIdStr)) ||
          (rowAdmStr && activeAdmissions.has(rowAdmStr)) ||
          (rowNormName && activeNormalizedNames.has(rowNormName));

        if (isStillEnrolled) {
          const dedupeKey = rowIdStr || rowAdmStr || rowNormName;

          if (dedupeKey && !seenIds.has(dedupeKey)) {
            seenIds.add(dedupeKey);
            uniqueSavedScores.push({
              ...row,
              broughtForward: resolveBF(row.studentId, row.admissionNo, row.name)
            });
          }
        }
      });

      // STEP B: Append any NEWLY ENROLLED students not yet in the saved grid
      currentEnrolledStudents.forEach(student => {
        const studentFullName = student.name 
          ? student.name 
          : `${student.surname || student.lastName || ''} ${student.firstname || student.firstName || ''}`.trim();

        const sAdm = (student.admissionNo || student.registrationNo || '').toString().trim().toUpperCase();
        const sIdStr = student._id.toString();

        const alreadyPresent = uniqueSavedScores.some(s => {
          const cellId = (s.studentId || s.id || '').toString();
          const cellAdm = (s.admissionNo || '').toString().trim().toUpperCase();
          const cellNormName = normalizeName(s.name || '');

          return (
            (cellId && cellId === sIdStr) ||
            (sAdm && cellAdm && sAdm === cellAdm) ||
            (cellNormName && cellNormName === normalizeName(studentFullName))
          );
        });

        if (!alreadyPresent) {
          const autoBF = resolveBF(student._id, student.admissionNo, studentFullName);
          uniqueSavedScores.push({
            studentId: student._id,
            admissionNo: student.admissionNo || student.registrationNo || student._id.toString().slice(-6),
            name: studentFullName || 'Unnamed Student',
            ca1: 0, ca2: 0, project: 0, exam: 0, totalScore: 0,
            broughtForward: autoBF,
            averageScore: Math.round((autoBF / 2) * 100) / 100,
            grade: 'F', remark: 'FAIL'
          });
        }
      });

      grid.studentsScores = uniqueSavedScores;
    }

    const isLocked = grid.status === 'Submitted' || 
                     grid.status === 'Submitted for Review' || 
                     grid.status === 'Approved' || 
                     grid.status === 'Released';

    return res.status(200).json({ 
      success: true, 
      data: grid,
      isLocked,
      status: grid.status || 'Draft'
    });

  } catch (error) {
    console.error("💥 Error fetching grading grid:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching class grade sheet.",
      error: error.message
    });
  }
};

/**
 * @route   POST /api/teachers/save-grid
 * @desc    Save grading grid draft (strips deleted students before saving)
 * @access  Private (Teacher/Staff)
 */
export const saveGradingGridDraft = async (req, res) => {
  try {
    const { className, schoolSection, subjectName, term, session, studentsScores } = req.body;

    if (!className || !subjectName || !studentsScores) {
      return res.status(400).json({ success: false, message: "Please provide complete grid metadata payload." });
    }

    const cleanClass = className.trim();
    const classPattern = cleanClass.replace(/\s+/g, '\\s*');
    const classRegex = new RegExp(`^${classPattern}$`, 'i');

    const realStudents = await Student.find({
      $or: [
        { currentClass: classRegex },
        { assignedClass: classRegex },
        { className: classRegex },
        { class: classRegex }
      ]
    }).lean();

    // Map and sanitize incoming scores, dropping any orphan records
    const sanitizedScores = studentsScores
      .map((row) => {
        const rowName = normalizeName(row.name || '');
        const rowAdm = (row.admissionNo || '').trim().toUpperCase();

        const matchedStudent = realStudents.find(s => {
          const sName = normalizeName(s.name || `${s.surname || ''} ${s.firstname || s.firstName || ''}`);
          const sAdm = (s.admissionNo || s.registrationNo || '').trim().toUpperCase();
          
          return (
            (row.studentId && s._id.toString() === row.studentId.toString()) ||
            (rowAdm && sAdm && rowAdm === sAdm) ||
            (rowName && sName && (sName.includes(rowName) || rowName.includes(sName)))
          );
        });

        if (!matchedStudent && !row.studentId) return null;

        return {
          ...row,
          studentId: matchedStudent ? matchedStudent._id : row.studentId,
          admissionNo: matchedStudent ? matchedStudent.admissionNo : row.admissionNo
        };
      })
      .filter(Boolean);

    const updatedGrid = await GradingGrid.findOneAndUpdate(
      { 
        className: classRegex, 
        subjectName: new RegExp(`^${subjectName.trim().replace(/\s+/g, '\\s*')}$`, 'i'), 
        term: term.trim(), 
        session: session.trim() 
      },
      {
        $set: {
          className: cleanClass,
          schoolSection,
          subjectName: subjectName.trim(),
          term: term.trim(),
          session: session.trim(),
          studentsScores: sanitizedScores,
          status: 'Draft',
          updatedAt: new Date()
        }
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Grading matrix draft saved successfully.",
      data: updatedGrid
    });

  } catch (error) {
    console.error("💥 Error saving grading draft:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to persist draft scores into database.",
      error: error.message
    });
  }
};

/**
 * @route   POST /api/teachers/submit-broadsheet
 * @desc    Submit result broadsheet to Principal / Executive for review (locks the specific class)
 * @access  Private (Teacher/Staff)
 */
export const submitBroadsheetToPrincipal = async (req, res) => {
  try {
    const { className, term, session } = req.body;

    if (!className || !term || !session) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: className, term, and session."
      });
    }

    const cleanClass = className.trim();
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');

    // 🟢 ONLY UPDATE GRIDS BELONGING TO THIS SPECIFIC CLASS
    const updateResult = await GradingGrid.updateMany(
      { 
        className: classRegex, 
        term: term.trim(), 
        session: session.trim() 
      },
      { 
        $set: { status: 'Submitted for Review', updatedAt: new Date() } 
      }
    );

    return res.status(200).json({
      success: true,
      message: `Broadsheet for ${cleanClass} (${term}, ${session}) successfully submitted for Principal approval!`,
      modifiedCount: updateResult.modifiedCount
    });
  } catch (error) {
    console.error("💥 Error submitting broadsheet for review:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit class broadsheet for approval review.",
      error: error.message
    });
  }
};

/**
 * @route   GET /api/teachers/my-results/:studentId
 * @desc    Fetch student term result card and verify financial clearance
 * @access  Private (Student/Parent)
 */
export const getMyResults = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { term, session } = req.query;

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: "Student record profile not found." });
    }

    const selectedTerm = (term || "First Term").trim();
    const selectedSession = (session || "2026/2027").trim();

    // 1. Fetch ResultReview record
    const review = await ResultReview.findOne({
      studentId: student._id,
      session: selectedSession,
      term: new RegExp(`^${selectedTerm}$`, 'i')
    }).lean();

    const isReleased = review?.status === 'Released' || review?.isPublished || review?.isApprovedByExecutive;

    if (!isReleased) {
      return res.status(200).json({
        success: true,
        isReleased: false,
        isCleared: true,
        outstandingBalance: 0,
        message: `Continuous assessment sheets for ${selectedTerm} (${selectedSession}) are undergoing administrative verification.`
      });
    }

    // 2. 🟢 CUMULATIVE FINANCIAL CLEARANCE CALCULATION (UP TO TARGET TERM)
    const basePreviousOutstanding = Number(student.previousOutstanding) || 0;

    const allStructures = await FeeStructure.find({}).lean();
    allStructures.sort((a, b) => {
      const yearA = parseInt(a.session?.match(/^\d{4}/)?.[1] || 0, 10);
      const yearB = parseInt(b.session?.match(/^\d{4}/)?.[1] || 0, 10);
      if (yearA !== yearB) return yearA - yearB;
      
      const getTermOrder = (t) => /first|1st/i.test(t) ? 1 : /second|2nd/i.test(t) ? 2 : /third|3rd/i.test(t) ? 3 : 0;
      return getTermOrder(a.term) - getTermOrder(b.term);
    });

    const targetYear = parseInt(selectedSession.match(/^\d{4}/)?.[1] || 0, 10);
    const getTermOrder = (t) => /first|1st/i.test(t) ? 1 : /second|2nd/i.test(t) ? 2 : /third|3rd/i.test(t) ? 3 : 0;
    const targetTermOrder = getTermOrder(selectedTerm);

    let cumulativeFeesExpected = basePreviousOutstanding;

    allStructures.forEach(struct => {
      const structYear = parseInt(struct.session?.match(/^\d{4}/)?.[1] || 0, 10);
      const structTermOrder = getTermOrder(struct.term);

      const isUpToTarget = structYear < targetYear || (structYear === targetYear && structTermOrder <= targetTermOrder);

      if (isUpToTarget) {
        const studentClass = (student.currentClass || student.assignedClass || '').trim().toUpperCase();
        const structClass = (struct.className || '').trim().toUpperCase();

        if (structClass === studentClass || structClass.replace(/\s+/g, '') === studentClass.replace(/\s+/g, '')) {
          struct.items?.forEach(item => {
            if (item.checked !== false) {
              cumulativeFeesExpected += Number(item.amount) || 0;
            }
          });
        }
      }
    });

    const adjustments = await Adjustment.find({ studentId: student._id }).lean();
    
    adjustments.forEach(adj => {
      const adjYear = parseInt((adj.session || selectedSession).match(/^\d{4}/)?.[1] || 0, 10);
      const adjTermOrder = getTermOrder(adj.term || selectedTerm);
      const isUpToTarget = adjYear < targetYear || (adjYear === targetYear && adjTermOrder <= targetTermOrder);

      if (isUpToTarget) {
        const amt = Number(adj.amount) || 0;
        if (adj.type === 'Fee Increase') cumulativeFeesExpected += amt;
        if (adj.type === 'Discount' || adj.type === 'Waiver') cumulativeFeesExpected -= amt;
      }
    });

    const payments = await Payment.find({ studentId: student._id, status: 'Successful' }).lean();
    const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);

    const cumulativeOutstanding = Math.max(0, cumulativeFeesExpected - totalPaid);
    const isCleared = cumulativeOutstanding <= 0;

    return res.status(200).json({
      success: true,
      isReleased: true,
      isCleared,
      outstandingBalance: cumulativeOutstanding,
      data: review
    });

  } catch (error) {
    console.error("💥 Error fetching student result access:", error);
    return res.status(500).json({ success: false, message: "Error verifying result access clearance.", error: error.message });
  }
};