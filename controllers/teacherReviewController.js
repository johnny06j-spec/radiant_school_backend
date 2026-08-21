import Student from '../models/Student.js';
import GradingGrid from '../models/GradingGrid.js';
import ResultReview from '../models/ResultReview.js';
import { buildStudentResultSubjects } from '../utils/resultEngine.js';

const PRIMARY_CLASSES = ['KG 1', 'KG 2', 'Nursery 1', 'Nursery 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5'];

const normalizeName = (nameStr) => {
  if (!nameStr) return '';
  return nameStr.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const calculateGradeAndRemark = (score, isPrimary = false) => {
  const num = Number(score) || 0;
  if (isPrimary) {
    if (num >= 86) return { grade: 'A', remark: 'EXCELLENT' };
    if (num >= 70) return { grade: 'B', remark: 'VERY GOOD' };
    if (num >= 50) return { grade: 'C', remark: 'GOOD' };
    if (num >= 45) return { grade: 'D', remark: 'FAIR' };
    if (num >= 40) return { grade: 'E', remark: 'WEAK' };
    return { grade: 'F', remark: 'FAIL' };
  } else {
    if (num >= 90) return { grade: 'A*', remark: 'EXCELLENT' };
    if (num >= 70) return { grade: 'A', remark: 'VERY GOOD' };
    if (num >= 60) return { grade: 'B', remark: 'GOOD' };
    if (num >= 50) return { grade: 'C', remark: 'AVERAGE' };
    if (num >= 40) return { grade: 'D', remark: 'FAIR' };
    if (num >= 30) return { grade: 'E', remark: 'WEAK' };
    return { grade: 'F', remark: 'FAIL' };
  }
};

/**
 * @route   GET /api/teachers/review-single
 * @desc    Fetch aggregated scores for Ready Results along with student metadata
 */
export const getStudentResultReview = async (req, res) => {
  try {
    const { studentId, className, term, session, admissionNo } = req.query;

    if (!studentId || !term || !session) {
      return res.status(400).json({ success: false, message: "Missing required query parameters." });
    }

    const cleanClass = className ? className.trim() : '';
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');
    const isPrimary = PRIMARY_CLASSES.some(c => c.toLowerCase() === cleanClass.toLowerCase());

    const studentDoc = await Student.findById(studentId).lean().catch(() => null);
    const targetNormName = normalizeName(studentDoc?.name || '');
    const targetAdmNo = (admissionNo || studentDoc?.admissionNo || '').toString().trim().toUpperCase();

    let previousTerm = null;
    if (term === 'Second Term') previousTerm = 'First Term';
    if (term === 'Third Term') previousTerm = 'Second Term';

    let prevGridsMap = {};
    if (previousTerm) {
      const priorGrids = await GradingGrid.find({ className: classRegex, term: previousTerm, session }).lean();

      priorGrids.forEach(pg => {
        const matchingPrevCell = pg.studentsScores?.find(s => {
          const cellId = (s.studentId || s.id || '').toString();
          const cellAdm = (s.admissionNo || '').toString().trim().toUpperCase();
          const cellNormName = normalizeName(s.name || '');

          return (
            (cellId && cellId === studentId.toString()) ||
            (targetAdmNo && cellAdm && cellAdm === targetAdmNo) ||
            (targetNormName && cellNormName && (cellNormName.includes(targetNormName) || targetNormName.includes(cellNormName)))
          );
        });

        if (matchingPrevCell) {
          const prevScore = Number(matchingPrevCell.averageScore ?? matchingPrevCell.totalScore) || 0;
          prevGridsMap[pg.subjectName.trim().toUpperCase()] = prevScore;
        }
      });
    }

    const grids = await GradingGrid.find({ className: classRegex, term, session }).lean();

    let studentSubjectScores = [];
    let totalScoreSum = 0;
    let subjectCount = 0;

    grids.forEach(grid => {
      const studentCell = grid.studentsScores?.find(s => {
        const cellId = (s.studentId || s.id || '').toString();
        const cellAdm = (s.admissionNo || '').toString().trim().toUpperCase();
        const cellNormName = normalizeName(s.name || '');

        return (
          (cellId && cellId === studentId.toString()) ||
          (targetAdmNo && cellAdm && cellAdm === targetAdmNo) ||
          (targetNormName && cellNormName && (cellNormName.includes(targetNormName) || targetNormName.includes(cellNormName)))
        );
      });

      if (studentCell) {
        const currentTotal = Number(studentCell.totalScore) || (
          (Number(studentCell.ca1) || 0) + 
          (Number(studentCell.ca2) || 0) + 
          (Number(studentCell.project) || 0) + 
          (Number(studentCell.exam) || 0)
        );

        const subjectKey = grid.subjectName.trim().toUpperCase();
        let exactBF = Number(studentCell.broughtForward) || 0;

        if (exactBF === 0 && prevGridsMap[subjectKey]) {
          exactBF = prevGridsMap[subjectKey];
        }

        const exactTotalAvg = term !== 'First Term' && exactBF > 0
          ? Math.round(((currentTotal + exactBF) / 2) * 100) / 100
          : currentTotal;

        const evalResult = calculateGradeAndRemark(exactTotalAvg, isPrimary);

        studentSubjectScores.push({
          subject: grid.subjectName,
          ca1: studentCell.ca1 ?? 0,
          ca2: studentCell.ca2 ?? 0,
          project: studentCell.project ?? 0,
          exam: studentCell.exam ?? 0,
          totalScore: currentTotal,
          broughtForward: exactBF,
          averageScore: exactTotalAvg,
          grade: evalResult.grade,
          remark: evalResult.remark,
          isEntered: true
        });

        totalScoreSum += exactTotalAvg;
        subjectCount++;
      }
    });

    const overallAverage = subjectCount > 0 ? Math.round((totalScoreSum / subjectCount) * 100) / 100 : 0;

    let reviewDoc = await ResultReview.findOne({ studentId, term, session });
    if (!reviewDoc) {
      reviewDoc = {
        studentId,
        className: cleanClass,
        term,
        session,
        status: 'Pending Review',
        overallAverage,
        characterDevelopment: { attendance: 'A', attentiveness: 'A', neatness: 'A', selfControl: 'A', punctuality: 'A', relationshipWithOthers: 'A' },
        practicalSkills: { handwriting: 'A', music: 'A', drama: 'A', games: 'A', crafts: 'A', clubs: 'A', reading: 'A' },
        teacherRemark: '',
        principalRemark: '',
        promotionDecision: 'N/A',
        promotedToClass: '',
        rejectionReason: ''
      };
    } else {
      reviewDoc.overallAverage = overallAverage;
    }

    const formattedStudent = studentDoc ? {
      _id: studentDoc._id,
      name: studentDoc.name || `${studentDoc.surname || ''} ${studentDoc.firstname || studentDoc.firstName || ''}`.trim(),
      firstName: studentDoc.firstName || studentDoc.firstname || studentDoc.name?.split(' ')[0] || 'Student',
      lastName: studentDoc.lastName || studentDoc.surname || studentDoc.name?.split(' ').slice(1).join(' ') || '',
      admissionNo: studentDoc.admissionNo || studentDoc.registrationNo || 'N/A',
      passportUrl: studentDoc.passportPhoto || studentDoc.passportUrl || studentDoc.passport || studentDoc.avatar || studentDoc.photo || ''
    } : null;

    return res.status(200).json({
      success: true,
      data: {
        student: formattedStudent,
        review: reviewDoc,
        subjects: studentSubjectScores,
        overallAverage,
        subjectCount
      }
    });

  } catch (error) {
    console.error("💥 Error in getStudentResultReview:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route   POST /api/teachers/save-review
 * @desc    Save single teacher result draft or submit for Principal / HM review
 */
export const saveResultReview = async (req, res) => {
  try {
    const { 
      studentId, className, schoolSection, term, session, 
      characterDevelopment, practicalSkills, teacherRemark, submitAction 
    } = req.body;

    const newStatus = submitAction === 'SUBMIT' ? 'Submitted' : 'Pending Review';

    const studentDoc = await Student.findById(studentId).select('name surname firstname firstName admissionNo registrationNo').lean();
    const displayName = studentDoc?.name || `${studentDoc?.surname || ''} ${studentDoc?.firstname || studentDoc?.firstName || ''}`.trim() || 'Student';
    const displayAdm = studentDoc?.admissionNo || studentDoc?.registrationNo || 'N/A';
    const cleanClass = className ? className.trim() : '';

    // Run the central calculation engine to compute canonical subjects, brought-forward scores, and overall average
    const computedData = await buildStudentResultSubjects({
      studentId,
      studentDoc,
      className: cleanClass,
      term: term.trim(),
      session: session.trim()
    });

    const updatedReview = await ResultReview.findOneAndUpdate(
      { studentId, term: term.trim(), session: session.trim() },
      {
        $set: {
          studentId,
          name: displayName,
          admissionNo: displayAdm,
          className: cleanClass,
          schoolSection,
          term: term.trim(),
          session: session.trim(),
          characterDevelopment,
          practicalSkills,
          teacherRemark,
          status: newStatus,
          rejectionReason: '',
          subjects: computedData.subjects,
          overallAverage: computedData.overallAverage,
          overallGrade: computedData.overallGrade,
          teacherSubmittedAt: submitAction === 'SUBMIT' ? new Date() : undefined
        }
      },
      { new: true, upsert: true }
    );

    if (cleanClass) {
      await GradingGrid.updateMany(
        { className: cleanClass, term: term.trim(), session: session.trim() },
        { $set: { status: newStatus, rejectionReason: '' } }
      );
    }

    return res.status(200).json({
      success: true,
      message: submitAction === 'SUBMIT' ? "Student result submitted for executive approval!" : "Review draft saved successfully.",
      data: updatedReview
    });
  } catch (error) {
    console.error("💥 Error saving result review:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route   POST /api/teachers/submit-batch-class
 * @desc    Submit entire class results to Principal / HM at once
 */
export const submitBatchClassResults = async (req, res) => {
  try {
    const { className, term, session, schoolSection } = req.body;

    if (!className || !term || !session) {
      return res.status(400).json({ success: false, message: "Missing class or session data." });
    }

    const cleanClass = className.trim();
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');

    const students = await Student.find({
      $or: [{ currentClass: classRegex }, { assignedClass: classRegex }]
    }).select('_id name surname firstname firstName admissionNo registrationNo');

    if (!students || students.length === 0) {
      return res.status(404).json({ success: false, message: "No enrolled students found in this class." });
    }

    for (const s of students) {
      const displayName = s.name || `${s.surname || ''} ${s.firstname || s.firstName || ''}`.trim() || 'Student';
      const displayAdm = s.admissionNo || s.registrationNo || 'N/A';

      // Compute canonical cumulative scores for every student in the batch
      const computedData = await buildStudentResultSubjects({
        studentId: s._id,
        studentDoc: s,
        className: cleanClass,
        term: term.trim(),
        session: session.trim()
      });

      await ResultReview.findOneAndUpdate(
        { studentId: s._id, term: term.trim(), session: session.trim() },
        {
          $set: {
            studentId: s._id,
            name: displayName,
            admissionNo: displayAdm,
            className: cleanClass,
            schoolSection: schoolSection || 'PRIMARY',
            term: term.trim(),
            session: session.trim(),
            status: 'Submitted',
            subjects: computedData.subjects,
            overallAverage: computedData.overallAverage,
            overallGrade: computedData.overallGrade,
            teacherSubmittedAt: new Date(),
            rejectionReason: ''
          }
        },
        { upsert: true }
      );
    }

    await GradingGrid.updateMany(
      { className: classRegex, term: term.trim(), session: session.trim() },
      { $set: { status: 'Submitted', rejectionReason: '' } }
    );

    return res.status(200).json({
      success: true,
      message: `Results for all ${students.length} students in ${cleanClass} submitted to Executive Desk successfully with cumulative calculations!`
    });
  } catch (error) {
    console.error("💥 Error in batch submission:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};