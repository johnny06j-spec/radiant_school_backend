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
 * @desc    Fetch grading grid sheet strictly filtered by class AND campus
 * @access  Private (Teacher/Staff)
 */
export const fetchGradingGrid = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const { className, subjectName, term, session, campus } = req.query;

    if (!className || !subjectName) {
      return res.status(400).json({
        success: false,
        message: "Missing className or subjectName query parameters."
      });
    }

    // Determine target campus from request or authenticated user profile
    const targetCampus = (campus && campus !== 'All Campuses' && campus !== 'undefined')
      ? campus.trim()
      : (req.user?.campus || 'Emerald Campus');

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
        session,
        campus: targetCampus // Campus-isolated prior term check
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

    // 2. Fetch Live Active Students Enrolled STRICTLY in this Class AND Campus
    const studentQuery = {
      $or: [
        { currentClass: classRegex },
        { assignedClass: classRegex },
        { className: classRegex },
        { class: classRegex }
      ],
      status: { $in: ['Active', 'active', null] }
    };

    if (targetCampus) {
      studentQuery.campus = targetCampus; // Filter by Campus
    }

    const currentEnrolledStudents = await Student.find(studentQuery)
      .sort({ surname: 1, firstname: 1, firstName: 1, name: 1 })
      .lean();

    // Build fast lookup sets for active campus students
    const activeStudentIds = new Set(currentEnrolledStudents.map(s => s._id.toString()));
    const activeAdmissions = new Set(
      currentEnrolledStudents
        .map(s => (s.admissionNo || s.registrationNo || '').toString().trim().toUpperCase())
        .filter(Boolean)
    );
    const activeNormalizedNames = new Set(
      currentEnrolledStudents.map(s => normalizeName(s.name || `${s.surname || ''} ${s.firstname || s.firstName || ''}`))
    );

    // FETCH GRID MATCHING CAMPUS, CLASS, SUBJECT, TERM, SESSION
    let grid = await GradingGrid.findOne({
      className: classRegex,
      subjectName: new RegExp(`^${cleanSubject.replace(/\s+/g, '\\s*')}$`, 'i'),
      term: term.trim(),
      session: session.trim(),
      campus: targetCampus // Match Campus
    });

    // 3. Initialize or Sync Grid
    if (!grid || !grid.studentsScores || grid.studentsScores.length === 0) {
      // Fresh Grid for Active Campus Students Only
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
        campus: targetCampus,
        status: 'Draft',
        studentsScores
      };
    } else {
      grid = grid.toObject();
      const seenIds = new Set();
      const uniqueSavedScores = [];

      // STEP A: Keep only saved score rows belonging to active campus students
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

      // STEP B: Append any NEWLY ENROLLED campus students not yet in grid
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
 * @desc    Save grading grid draft safely with campus binding (Bypasses Duplicate Key E11000)
 * @access  Private (Teacher/Staff)
 */
export const saveGradingGridDraft = async (req, res) => {
  try {
    const { 
      className, schoolSection, subject, subjectName, 
      term, session, campus, records, studentsScores 
    } = req.body;

    const targetSubject = (subject || subjectName || '').trim();
    const targetClass = (className || '').trim();
    const targetTerm = (term || '').trim();
    const targetSession = (session || '').trim();

    const rawScores = Array.isArray(records) ? records : (Array.isArray(studentsScores) ? studentsScores : null);

    if (!targetClass || !targetSubject || !targetTerm || !targetSession || !rawScores) {
      return res.status(400).json({ 
        success: false, 
        message: "Please provide complete grid metadata payload (className, subject, term, session, records)." 
      });
    }

    const targetCampus = (campus && campus !== 'All Campuses') 
      ? campus.trim() 
      : (req.user?.campus || 'Emerald Campus');

    const classPattern = targetClass.replace(/\s+/g, '\\s*');
    const classRegex = new RegExp(`^${classPattern}$`, 'i');
    const subjectRegex = new RegExp(`^${targetSubject.replace(/\s+/g, '\\s*')}$`, 'i');

    const realStudents = await Student.find({
      $or: [
        { currentClass: classRegex },
        { assignedClass: classRegex },
        { className: classRegex },
        { class: classRegex }
      ],
      campus: targetCampus // Restrict matched students to target campus
    }).lean();

    const sanitizedScores = rawScores
      .map((row) => {
        const rowName = normalizeName(row.name || row.studentName || '');
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

        const ca1 = Number(row.ca1 ?? row.test1 ?? 0);
        const ca2 = Number(row.ca2 ?? row.test2 ?? 0);
        const proj = Number(row.project ?? row.proj ?? 0);
        const exam = Number(row.exam ?? 0);
        const totalScore = Number(row.totalScore) || (ca1 + ca2 + proj + exam);

        return {
          studentId: matchedStudent ? matchedStudent._id : row.studentId,
          admissionNo: matchedStudent ? matchedStudent.admissionNo : row.admissionNo,
          name: row.name || row.studentName || (matchedStudent ? matchedStudent.name : 'Student'),
          ca1,
          ca2,
          project: proj,
          exam,
          totalScore,
          broughtForward: Number(row.broughtForward ?? row.cumBF ?? 0),
          averageScore: Number(row.averageScore ?? totalScore),
          grade: row.grade || 'F',
          remark: row.remark || 'SATISFACTORY'
        };
      })
      .filter(Boolean);

    // 🟢 Step A: Query specifically for THIS campus's grid
    let existingGrid = await GradingGrid.findOne({
      className: classRegex,
      subjectName: subjectRegex,
      term: targetTerm,
      session: targetSession,
      campus: targetCampus // 🔒 Strictly isolated by campus
    });

    let updatedGrid;

    if (existingGrid) {
      // 🟢 Step B: Update document instance for THIS campus
      existingGrid.className = targetClass;
      existingGrid.schoolSection = schoolSection || existingGrid.schoolSection;
      existingGrid.subjectName = targetSubject;
      existingGrid.term = targetTerm;
      existingGrid.session = targetSession;
      existingGrid.campus = targetCampus;
      existingGrid.studentsScores = sanitizedScores;
      existingGrid.status = 'Draft';
      existingGrid.updatedAt = new Date();

      updatedGrid = await existingGrid.save();
    } else {
      // 🟢 Step C: Create a NEW distinct grid document for this campus
      updatedGrid = await GradingGrid.create({
        className: targetClass,
        schoolSection,
        subjectName: targetSubject,
        term: targetTerm,
        session: targetSession,
        campus: targetCampus,
        studentsScores: sanitizedScores,
        status: 'Draft'
      });
    }

    return res.status(200).json({
      success: true,
      message: "Grading matrix draft saved successfully.",
      data: updatedGrid,
      grid: updatedGrid
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
 * @desc    Submit result broadsheet filtered strictly by class and campus
 * @access  Private (Teacher/Staff)
 */
export const submitBroadsheetToPrincipal = async (req, res) => {
  try {
    const { className, term, session, campus } = req.body;

    if (!className || !term || !session) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: className, term, and session."
      });
    }

    const targetCampus = campus || req.user?.campus || 'Emerald Campus';
    const cleanClass = className.trim();
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');

    const gridFilter = { 
      className: classRegex, 
      term: term.trim(), 
      session: session.trim() 
    };

    if (targetCampus && targetCampus !== 'All Campuses') {
      gridFilter.campus = targetCampus;
    }

    const updateResult = await GradingGrid.updateMany(
      gridFilter,
      { 
        $set: { status: 'Submitted for Review', updatedAt: new Date() } 
      }
    );

    return res.status(200).json({
      success: true,
      message: `Broadsheet for ${cleanClass} - ${targetCampus} (${term}, ${session}) successfully submitted for Principal approval!`,
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
        const studentCampus = (student.campus || 'Emerald Campus').trim();
        const structCampus = (struct.campus || 'Emerald Campus').trim();

        // Fee Match by Class & Campus
        if ((structClass === studentClass || structClass.replace(/\s+/g, '') === studentClass.replace(/\s+/g, '')) && structCampus === studentCampus) {
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