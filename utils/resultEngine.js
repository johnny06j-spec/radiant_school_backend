// utils/resultEngine.js
import GradingGrid from '../models/GradingGrid.js';
import Student from '../models/Student.js';

export const PRIMARY_CLASSES = [
  'KG 1', 'KG 2', 'NURSERY 1', 'NURSERY 2', 
  'BASIC 1', 'BASIC 2', 'BASIC 3', 'BASIC 4', 'BASIC 5'
];

export const normalizeSubjectName = (name) => {
  if (!name) return '';
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
};

export const normalizeName = (nameStr) => {
  if (!nameStr) return '';
  return nameStr.toLowerCase().replace(/[^a-z0-9]/g, '');
};

export const calculateGradeAndRemark = (score, isPrimary = false) => {
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
 * Builds the canonical calculated subject list with CUM B.F and overall averages
 */
export const buildStudentResultSubjects = async ({ studentId, studentDoc, className, term, session }) => {
  const cleanClass = (className || studentDoc?.currentClass || '').trim();
  const isPrimary = PRIMARY_CLASSES.some(c => c === cleanClass.toUpperCase());
  const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');
  const normalizedTerm = (term || '').trim().toUpperCase();
  const isFirstTerm = normalizedTerm === 'FIRST TERM' || normalizedTerm === '1ST TERM';

  let student = studentDoc;
  if (!student && studentId) {
    student = await Student.findById(studentId).lean().catch(() => null);
  }

  const studentAdm = (student?.admissionNo || student?.registrationNo || '').toString().trim().toUpperCase();
  const studentTargetName = normalizeName(student?.name || `${student?.surname || ''} ${student?.firstName || ''}`);

  // 1. Fetch Previous Term Scores Map for B.F. lookup
  let prevScoresMap = {};
  if (!isFirstTerm) {
    const priorTermRegex = normalizedTerm.includes('THIRD') || normalizedTerm.includes('3RD') 
      ? /second|2nd/i 
      : /first|1st/i;

    const priorGrids = await GradingGrid.find({
      term: priorTermRegex,
      session: session.trim()
    }).lean();

    priorGrids.forEach(pg => {
      const match = pg.studentsScores?.find(s => {
        const cellId = (s.studentId || s.id || '').toString();
        const cellAdm = (s.admissionNo || '').toString().trim().toUpperCase();
        const cellName = normalizeName(s.name || '');

        return (
          (cellId && cellId === student?._id?.toString()) ||
          (studentAdm && cellAdm && cellAdm === studentAdm) ||
          (studentTargetName && cellName && (cellName.includes(studentTargetName) || studentTargetName.includes(cellName)))
        );
      });

      if (match) {
        const total = Number(match.totalScore) || (
          (Number(match.ca1) || 0) + (Number(match.ca2) || 0) + (Number(match.project) || 0) + (Number(match.exam) || 0)
        );
        const subKey = normalizeSubjectName(pg.subjectName);
        if (subKey) prevScoresMap[subKey] = total;
      }
    });
  }

  // 2. Fetch Current Term Scores from GradingGrids
  const currentGrids = await GradingGrid.find({
    className: classRegex,
    term: new RegExp(`^${term.trim()}$`, 'i'),
    session: session.trim()
  }).lean();

  let subjects = [];
  let cumulativeSum = 0;

  currentGrids.forEach(grid => {
    const cell = grid.studentsScores?.find(s => {
      const cellId = (s.studentId || s.id || '').toString();
      const cellAdm = (s.admissionNo || '').toString().trim().toUpperCase();
      const cellName = normalizeName(s.name || '');

      return (
        (cellId && cellId === student?._id?.toString()) ||
        (studentAdm && cellAdm && cellAdm === studentAdm) ||
        (studentTargetName && cellName && (cellName.includes(studentTargetName) || studentTargetName.includes(cellName)))
      );
    });

    if (cell) {
      const test1 = Number(cell.ca1) || 0;
      const test2 = Number(cell.ca2) || 0;
      const proj = Number(cell.project) || 0;
      const exam = Number(cell.exam) || 0;
      const total = Number(cell.totalScore) || (test1 + test2 + proj + exam);

      const subKey = normalizeSubjectName(grid.subjectName);
      let bf = Number(cell.broughtForward) || prevScoresMap[subKey] || 0;

      const averageScore = (!isFirstTerm && bf > 0)
        ? Math.round(((total + bf) / 2) * 100) / 100
        : total;

      const evalGrade = calculateGradeAndRemark(averageScore, isPrimary);

      subjects.push({
        subject: grid.subjectName,
        test1,
        test2,
        proj,
        exam,
        total,
        cumBF: !isFirstTerm && bf > 0 ? bf : '-',
        broughtForward: bf,
        average: averageScore,
        averageScore,
        grade: evalGrade.grade,
        remark: evalGrade.remark
      });

      cumulativeSum += averageScore;
    }
  });

  const overallAverage = subjects.length > 0
    ? Math.round((cumulativeSum / subjects.length) * 100) / 100
    : 0;

  const overallGrade = calculateGradeAndRemark(overallAverage, isPrimary).grade;

  return {
    student,
    isPrimary,
    subjects,
    overallAverage,
    overallGrade,
    subjectCount: subjects.length
  };
};