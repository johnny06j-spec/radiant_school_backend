// controllers/portalResultController.js
import fs from 'fs';
import path from 'path';
import Student from '../models/Student.js';
import ResultReview from '../models/ResultReview.js';
import SystemConfig from '../models/SystemConfig.js';
import FeeStructure from '../models/FeeStructure.js';
import Payment from '../models/Payment.js';
import Adjustment from '../models/Adjustment.js';
import { normalizeClassName } from './financeHelpers.js';
import { buildStudentResultSubjects } from '../utils/resultEngine.js';

const getBase64Image = (relativePath) => {
  try {
    const fullPath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(fullPath)) {
      const fileBuffer = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).replace('.', '') || 'png';
      return `data:image/${ext};base64,${fileBuffer.toString('base64')}`;
    }
  } catch (err) {
    console.warn(`Could not load local asset at ${relativePath}:`, err.message);
  }
  return '';
};

/**
 * Helper to extract starting year from session string (e.g., "2026/2027" -> 2026)
 */
const getSessionStartYear = (sessionStr) => {
  if (!sessionStr) return 0;
  const match = String(sessionStr).match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Helper to determine term chronological weight
 */
const getTermOrder = (termName) => {
  if (!termName) return 0;
  const normalized = String(termName).trim().toLowerCase();
  if (normalized.includes('first') || normalized.includes('1st')) return 1;
  if (normalized.includes('second') || normalized.includes('2nd')) return 2;
  if (normalized.includes('third') || normalized.includes('3rd')) return 3;
  return 0;
};

/**
 * @route   GET /api/teachers/download-result-pdf/:studentId
 * @desc    Generate printable report card matching the Headmaster/Principal signed-off data
 */
export const downloadStudentResultPdf = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { term, session, className } = req.query;

    const studentDoc = await Student.findById(studentId).lean().catch(() => null);
    
    // Find matching review by studentId or _id
    const review = await ResultReview.findOne({
      $or: [{ studentId }, { _id: studentId }],
      ...(term ? { term: new RegExp(`^${term.trim()}$`, 'i') } : {}),
      ...(session ? { session: session.trim() } : {})
    }).lean();

    const activeTerm = term || review?.term || 'Second Term';
    const activeSession = session || review?.session || '2026/2027';
    const activeClass = className || review?.className || studentDoc?.currentClass || 'KG 1';

    const isPrimary = !['JSS', 'SSS'].some(sec => activeClass.toUpperCase().includes(sec));
    const isFirstTerm = activeTerm.toUpperCase().includes('FIRST') || activeTerm.toUpperCase().includes('1ST');

    // 1. Prioritize pre-computed subjects and cumulative scores from the approved review
    let subjects = [];
    let overallAverage = Number(review?.overallAverage || 0);
    let overallGrade = review?.overallGrade || 'A';
    let subjectCount = 0;

    if (Array.isArray(review?.subjects) && review.subjects.length > 0) {
      subjects = review.subjects.map(s => {
        const t1 = Number(s.test1 ?? s.ca1 ?? 0);
        const t2 = Number(s.test2 ?? s.ca2 ?? 0);
        const prj = Number(s.project ?? s.proj ?? 0);
        const ex = Number(s.exam ?? s.examScore ?? 0);
        const tot = Number(s.total ?? (t1 + t2 + (isPrimary ? 0 : prj) + ex));
        const cum = s.cumBF ?? s.cumulativeBF ?? s.previousTermTotal ?? '-';
        const avg = s.average ? Number(s.average) : (cum !== '-' ? (tot + Number(cum)) / 2 : tot);

        return {
          subject: s.subject || s.subjectName || 'Subject',
          test1: t1,
          test2: t2,
          proj: prj,
          exam: ex,
          total: tot,
          cumBF: cum,
          average: avg,
          grade: s.grade || 'A',
          remark: s.remark || 'VERY GOOD'
        };
      });
      subjectCount = subjects.length;
    } else {
      // Fallback to dynamic engine calculation
      const calcResult = await buildStudentResultSubjects({
        studentId,
        studentDoc,
        className: activeClass,
        term: activeTerm,
        session: activeSession
      });
      subjects = calcResult.subjects;
      if (!overallAverage) overallAverage = calcResult.overallAverage;
      if (!overallGrade) overallGrade = calcResult.overallGrade;
      subjectCount = calcResult.subjectCount;
    }

    const displayName = review?.name || (studentDoc ? `${studentDoc.surname || ''} ${studentDoc.firstName || studentDoc.name || ''}`.trim() : 'STUDENT');
    const displayAdm = review?.admissionNo || studentDoc?.admissionNo || 'N/A';
    const schoolTitle = isPrimary ? "RADIANT INTELLECTUALS NURSERY & PRIMARY SCHOOL" : "RADIANT INTELLECTUALS SENIOR SECONDARY SCHOOL";
    const execTitle = isPrimary ? "Headmaster" : "Principal";
    const logoBase64 = getBase64Image('public/assets/Logo.png');

    const characterMap = review?.characterDevelopment && Object.keys(review.characterDevelopment).length > 0
      ? review.characterDevelopment
      : { attendance: 'A', attentiveness: 'A', neatness: 'A', selfControl: 'A', punctuality: 'A', relationshipWithOthers: 'A' };

    const skillsMap = review?.practicalSkills && Object.keys(review.practicalSkills).length > 0
      ? review.practicalSkills
      : { handwriting: 'A', music: 'A', drama: 'A', games: 'A', crafts: 'A', clubs: 'A', reading: 'A' };

    const formatSkillRating = (val) => {
      const map = { 'A': 'A Excellent', 'B': 'B Very Good', 'C': 'C Good', 'D': 'D Fair', 'E': 'E Weak', 'F': 'F Fail' };
      return `<span class="grade-pill">${map[val] || `${val} Good`}</span>`;
    };

    const pdfHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Result Sheet - ${displayName}</title>
          <style>
            * { box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; }
            body { padding: 20px; background: #fff; color: #111; max-width: 900px; margin: 0 auto; }
            .header { text-align: center; border-bottom: 2px solid #064e3b; padding-bottom: 10px; margin-bottom: 15px; position: relative; }
            .header-logo { position: absolute; left: 10px; top: 0; height: 75px; width: auto; }
            .passport-photo { position: absolute; right: 10px; top: 0; height: 80px; width: 70px; object-fit: cover; border: 1px solid #064e3b; border-radius: 4px; }
            .header h2 { margin: 0; color: #064e3b; font-size: 20px; font-weight: 800; text-transform: uppercase; padding: 0 80px; }
            .header p { margin: 2px 0; font-size: 11px; color: #374151; font-weight: 600; }
            .session-badge { background: #064e3b; color: #fff; display: inline-block; padding: 4px 14px; font-weight: bold; font-size: 11px; border-radius: 4px; margin-top: 6px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; font-size: 11px; margin-bottom: 15px; }
            .info-grid strong { color: #064e3b; display: block; margin-bottom: 2px; }
            table.scores-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 15px; }
            table.scores-table th { background: #064e3b; color: #fff; padding: 6px 4px; text-align: center; font-size: 10px; border: 1px solid #064e3b; }
            table.scores-table td { padding: 6px 4px; border: 1px solid #d1d5db; text-align: center; }
            table.scores-table td.subject { text-align: left; font-weight: 600; }
            .summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; text-align: center; }
            .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
            .card .title { font-size: 9px; color: #6b7280; font-weight: bold; text-transform: uppercase; }
            .card .value { font-size: 16px; font-weight: 800; color: #064e3b; margin-top: 4px; }
            .bottom-grid { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 12px; font-size: 10px; }
            .section-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; background: #fff; }
            .section-box h4 { margin: 0 0 8px 0; font-size: 11px; color: #064e3b; border-bottom: 1px solid #064e3b; padding-bottom: 4px; text-transform: uppercase; }
            .row-item { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px dashed #f3f4f6; }
            .grade-pill { background: #dcfce7; color: #166534; padding: 1px 6px; border-radius: 10px; font-weight: bold; font-size: 9px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            ${logoBase64 ? `<img src="${logoBase64}" class="header-logo" alt="School Crest" />` : ''}
            <h2>${schoolTitle}</h2>
            <p>OFF OLD IKARE ROAD AJAGUNMOLU LAYOUT, OWO, ONDO STATE.</p>
            <div class="session-badge">${activeSession} SESSION</div>
            ${studentDoc?.passportPhoto ? `<img src="${studentDoc.passportPhoto}" class="passport-photo" alt="Student Photo" />` : ''}
          </div>

          <div class="info-grid">
            <div><strong>Full Name:</strong> ${displayName}<br/><strong>Class:</strong> ${activeClass}</div>
            <div><strong>Term:</strong> ${activeTerm}<br/><strong>Session:</strong> ${activeSession}</div>
            <div><strong>Admission No.:</strong> ${displayAdm}<br/><strong>Status:</strong> ${review?.status || 'Approved'}</div>
          </div>

          <table class="scores-table">
            <thead>
              <tr>
                <th>S/N</th><th>SUBJECT</th><th>TEST 1</th><th>TEST 2</th>
                ${!isPrimary ? '<th>PROJ</th>' : ''}
                <th>EXAM</th><th>TOTAL (100)</th>
                ${!isFirstTerm ? '<th>CUM B.F</th><th>AVERAGE</th>' : ''}
                <th>GRADE</th><th>REMARK</th>
              </tr>
            </thead>
            <tbody>
              ${subjects.map((s, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td class="subject">${s.subject}</td>
                  <td>${s.test1}</td>
                  <td>${s.test2}</td>
                  ${!isPrimary ? `<td>${s.proj}</td>` : ''}
                  <td>${s.exam}</td>
                  <td>${s.total}%</td>
                  ${!isFirstTerm ? `<td>${s.cumBF !== '-' ? `${s.cumBF}%` : '-'}</td><td>${Number(s.average).toFixed(2)}</td>` : ''}
                  <td><span class="grade-pill">${s.grade}</span></td>
                  <td>${s.remark}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="summary-cards">
            <div class="card"><div class="title">Subjects Taken</div><div class="value">${subjectCount}</div></div>
            <div class="card"><div class="title">Overall Average</div><div class="value">${overallAverage.toFixed(2)}%</div></div>
            <div class="card"><div class="title">Overall Grade</div><div class="value">${overallGrade}</div></div>
            <div class="card"><div class="title">Status</div><div class="value" style="font-size: 12px; color: #059669;">PASSED</div></div>
          </div>

          <div class="bottom-grid">
            <div class="section-box">
              <h4>Character Development</h4>
              ${Object.entries(characterMap).map(([k, v]) => `<div class="row-item"><span>${k.toUpperCase()}</span> ${formatSkillRating(v)}</div>`).join('')}
            </div>
            <div class="section-box">
              <h4>Practical Skills</h4>
              ${Object.entries(skillsMap).map(([k, v]) => `<div class="row-item"><span>${k.toUpperCase()}</span> ${formatSkillRating(v)}</div>`).join('')}
            </div>
            <div class="section-box">
              <h4>Remarks & Sign-Off</h4>
              <p><strong>Class Teacher:</strong> "${review?.teacherRemark || 'Good performance.'}"</p>
              <p><strong>${execTitle}:</strong> "${review?.principalRemark || 'Satisfactory academic performance.'}"</p>
            </div>
          </div>
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(pdfHtml);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route   GET /api/teachers/my-results/:studentId
 * @desc    Fetch released results for student portal with automated cumulative financial gate
 */
export const getStudentPortalResults = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { term, session } = req.query;

    if (!studentId || studentId === 'undefined') {
      return res.status(400).json({ success: false, message: "Invalid or missing student ID parameter." });
    }

    const systemSettings = await SystemConfig.findOne({}).lean();
    const activeSession = session || systemSettings?.currentSession || "2026/2027";
    const activeTerm = term || systemSettings?.currentTerm || "Second Term";

    const student = await Student.findById(studentId).lean();
    if (!student) return res.status(404).json({ success: false, message: "Student record not found." });

    const review = await ResultReview.findOne({
      studentId: student._id,
      term: new RegExp(`^${activeTerm.trim()}$`, 'i'),
      session: activeSession.trim(),
      $or: [
        { status: 'Released' },
        { isPublished: true },
        { isApprovedByExecutive: true }
      ]
    }).lean();

    if (!review) {
      return res.status(200).json({
        success: true,
        isReleased: false,
        isCleared: true,
        message: `Results for ${student.currentClass || 'this class'} (${activeTerm}) are currently undergoing review or release preparation.`
      });
    }

    // 🟢 CUMULATIVE FINANCIAL CLEARANCE CALCULATION UP TO TARGET TERM
    const basePreviousOutstanding = Number(student.previousOutstanding) || 0;

    const allStructures = await FeeStructure.find({}).lean();
    const studentClass = normalizeClassName(student.currentClass || student.assignedClass || '');

    // Sort structures chronologically
    allStructures.sort((a, b) => {
      const yearA = getSessionStartYear(a.session);
      const yearB = getSessionStartYear(b.session);
      if (yearA !== yearB) return yearA - yearB;
      return getTermOrder(a.term) - getTermOrder(b.term);
    });

    const targetYear = getSessionStartYear(activeSession);
    const targetTermOrder = getTermOrder(activeTerm);

    let cumulativeFeesExpected = basePreviousOutstanding;

    // Sum all applicable fee structures chronologically up to selected term
    allStructures.forEach(struct => {
      const structYear = getSessionStartYear(struct.session);
      const structTermOrder = getTermOrder(struct.term);

      const isUpToTarget = structYear < targetYear || (structYear === targetYear && structTermOrder <= targetTermOrder);

      if (isUpToTarget && normalizeClassName(struct.className) === studentClass) {
        const intakeSession = String(student.intakeSession || student.admittedSession || student.admissionSession || '').trim();
        const studentType = intakeSession === struct.session ? 'New Students' : 'Returning Students';

        struct.items?.forEach(item => {
          if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
            cumulativeFeesExpected += Number(item.amount) || 0;
          }
        });
      }
    });

    // Sum adjustments up to selected term
    const adjustments = await Adjustment.find({ studentId: student._id }).lean();
    adjustments.forEach(adj => {
      const adjYear = getSessionStartYear(adj.session || activeSession);
      const adjTermOrder = getTermOrder(adj.term || activeTerm);
      const isUpToTarget = adjYear < targetYear || (adjYear === targetYear && adjTermOrder <= targetTermOrder);

      if (isUpToTarget) {
        const amt = Number(adj.amount) || 0;
        if (adj.type === 'Fee Increase') cumulativeFeesExpected += amt;
        if (adj.type === 'Discount' || adj.type === 'Waiver') cumulativeFeesExpected -= amt;
      }
    });

    // Subtract all successful payments
    const successfulPayments = await Payment.find({ studentId: student._id, status: 'Successful' }).lean();
    const totalPaid = successfulPayments.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);

    const outstandingBalance = Math.max(0, cumulativeFeesExpected - totalPaid);

    if (outstandingBalance > 0) {
      return res.status(200).json({
        success: true,
        isReleased: true,
        isCleared: false,
        outstandingBalance,
        message: "Financial restriction active. Please clear outstanding fees to view your report card."
      });
    }

    return res.status(200).json({
      success: true,
      isReleased: true,
      isCleared: true,
      data: review
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};