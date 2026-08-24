// controllers/executiveApprovalController.js
import Student from '../models/Student.js';
import GradingGrid from '../models/GradingGrid.js';
import ResultReview from '../models/ResultReview.js';
import { buildStudentResultSubjects } from '../utils/resultEngine.js';

/**
 * @route   POST /api/teachers/principal-approve
 * @desc    Approve student result & stamp promotion decision without premature class mutation
 */
export const approveResultByPrincipal = async (req, res) => {
  try {
    const { 
      studentId, 
      term, 
      session, 
      className, 
      schoolSection, 
      principalRemark, 
      executiveRemark,
      promotionDecision, 
      promotedToClass, 
      userRole 
    } = req.body;

    if (!studentId || !term || !session) {
      return res.status(400).json({ success: false, message: "Missing student metadata parameters." });
    }

    const studentDoc = await Student.findById(studentId).select('name surname firstname firstName admissionNo registrationNo currentClass').lean();
    const cleanClass = (className || studentDoc?.currentClass || '').trim();
    const displayName = studentDoc?.name || `${studentDoc?.surname || ''} ${studentDoc?.firstname || studentDoc?.firstName || ''}`.trim() || 'Student';
    const displayAdm = studentDoc?.admissionNo || studentDoc?.registrationNo || 'N/A';

    const isThirdTerm = term.toLowerCase().includes('third');
    const finalPromotion = isThirdTerm ? (promotionDecision || 'PROMOTED') : 'N/A';
    const finalNextClass = (isThirdTerm && finalPromotion === 'PROMOTED') ? (promotedToClass || '') : '';
    const remark = principalRemark || executiveRemark || 'Satisfactory academic performance.';

    // 1. Force the engine to calculate canonical cumulative scores (with Brought Forward)
    const computedData = await buildStudentResultSubjects({
      studentId,
      studentDoc,
      className: cleanClass,
      term: term.trim(),
      session: session.trim()
    });

    const finalSubjects = computedData?.subjects?.length > 0 ? computedData.subjects : [];
    const finalOverallAvg = computedData?.overallAverage !== undefined && computedData?.overallAverage !== null 
      ? Number(computedData.overallAverage) 
      : 0;

    const finalOverallGrade = computedData.overallGrade || 'A';

    const updateFields = {
      studentId,
      name: displayName,
      admissionNo: displayAdm,
      className: cleanClass,
      schoolSection: schoolSection || 'PRIMARY',
      term: term.trim(),
      session: session.trim(),
      status: 'Approved',
      isApprovedByExecutive: true,
      isApprovedByPrincipal: true,
      principalRemark: remark,
      principalApprovedAt: new Date(),
      promotionDecision: finalPromotion,
      promotedToClass: finalNextClass,
      reviewedByRole: userRole || 'executive',
      rejectionReason: '',
      subjects: finalSubjects,
      overallAverage: finalOverallAvg,
      overallGrade: finalOverallGrade
    };

    const updatedReview = await ResultReview.findOneAndUpdate(
      { studentId, term: term.trim(), session: session.trim() },
      { $set: updateFields },
      { new: true, upsert: true }
    );

    if (cleanClass) {
      const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');
      await GradingGrid.updateMany(
        { className: classRegex, term: term.trim(), session: session.trim() },
        { 
          $set: { 
            status: 'Approved', 
            rejectionReason: '',
            "studentsScores.$[elem].status": 'Approved',
            "studentsScores.$[elem].isApprovedByPrincipal": true,
            "studentsScores.$[elem].isApprovedByExecutive": true,
            "studentsScores.$[elem].principalRemark": remark
          } 
        },
        { arrayFilters: [{ "elem.studentId": studentId }] }
      );
    }

    // 🟢 Class promotion decision is stamped on ResultReview and executed on new session rollover.
    return res.status(200).json({
      success: true,
      message: `Result for ${displayName} approved successfully! Promotion decision stamped.`,
      data: updatedReview
    });
  } catch (error) {
    console.error("💥 Principal Approval Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route   POST /api/teachers/principal-reject
 * @desc    Reject result review and send back for revision
 */
export const rejectResultByPrincipal = async (req, res) => {
  try {
    const { studentId, term, session, rejectionReason } = req.body;

    if (!studentId || !rejectionReason) {
      return res.status(400).json({ success: false, message: "Please provide a reason for returning the result." });
    }

    const updatedReview = await ResultReview.findOneAndUpdate(
      { studentId, term: term.trim(), session: session.trim() },
      { 
        $set: { 
          status: 'Returned for Revision', 
          isApprovedByExecutive: false,
          isApprovedByPrincipal: false,
          rejectionReason: rejectionReason.trim(),
          returnReason: rejectionReason.trim(),
          returnedAt: new Date()
        } 
      },
      { new: true }
    );

    if (updatedReview?.className) {
      const classRegex = new RegExp(`^${updatedReview.className.trim().replace(/\s+/g, '\\s*')}$`, 'i');
      await GradingGrid.updateMany(
        { className: classRegex, term: term.trim(), session: session.trim() },
        { 
          $set: { 
            status: 'Returned for Revision', 
            rejectionReason: rejectionReason.trim(),
            "studentsScores.$[elem].status": 'Returned for Revision',
            "studentsScores.$[elem].isApprovedByExecutive": false,
            "studentsScores.$[elem].isApprovedByPrincipal": false
          } 
        },
        { arrayFilters: [{ "elem.studentId": studentId }] }
      );
    }

    return res.status(200).json({ 
      success: true, 
      message: "Result sheet returned to class teacher for revision.", 
      data: updatedReview 
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route   POST /api/teachers/admin-return-results
 * @desc    Admin returns approved class results back to HM/Principal for revision
 */
export const adminReturnResultsToHM = async (req, res) => {
  try {
    const { className, term, session, rejectionReason, reason } = req.body;

    if (!className || !term || !session) {
      return res.status(400).json({ 
        success: false, 
        message: "Please provide target class, term, and session." 
      });
    }

    const cleanClass = className.trim();
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');
    const finalReason = (rejectionReason || reason || 'Returned by Admin for revision.').trim();

    const reviewResult = await ResultReview.updateMany(
      { className: classRegex, term: term.trim(), session: session.trim() },
      {
        $set: {
          status: 'Returned for Revision',
          isApprovedByExecutive: false,
          isApprovedByPrincipal: false,
          rejectionReason: finalReason,
          returnReason: finalReason,
          returnedAt: new Date(),
          returnedBy: req.user?.name || req.user?.username || 'School Administrator'
        }
      }
    );

    await GradingGrid.updateMany(
      { className: classRegex, term: term.trim(), session: session.trim() },
      { 
        $set: { 
          status: 'Returned for Revision', 
          rejectionReason: finalReason,
          "studentsScores.$[].status": 'Returned for Revision',
          "studentsScores.$[].isApprovedByExecutive": false,
          "studentsScores.$[].isApprovedByPrincipal": false
        } 
      }
    );

    return res.status(200).json({
      success: true,
      message: `Successfully returned results for ${cleanClass} back to HM Desk!`,
      modifiedCount: reviewResult.modifiedCount
    });

  } catch (error) {
    console.error("💥 Error returning results to HM:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};