// controllers/adminReleaseController.js
import mongoose from 'mongoose';
import ResultReview from '../models/ResultReview.js';
import GradingGrid from '../models/GradingGrid.js';
import Student from '../models/Student.js';

/**
 * @route   GET /api/teachers/admin-approved-reviews
 * @desc    Fetch strictly HM/Principal approved results ready for Admin release check
 */
export const getApprovedExecutiveReviews = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { className, term, session } = req.query;
    if (!className || !term || !session) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class, Term, and Session are required parameters.' 
      });
    }

    const cleanClass = className.trim();
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');

    const reviews = await ResultReview.find({
      $or: [{ className: classRegex }, { class: classRegex }],
      term: term.trim(),
      session: session.trim(),
      $and: [
        {
          $or: [
            { status: 'Approved' },
            { status: 'Approved by Principal' },
            { status: 'Approved by Executive' },
            { status: 'Approved By HM' },
            { isApprovedByExecutive: true },
            { isApprovedByPrincipal: true }
          ]
        },
        { status: { $ne: 'Returned for Revision' } },
        { status: { $ne: 'Released' } },
        { status: { $ne: 'Submitted' } }
      ]
    }).lean();

    const formattedReviews = await Promise.all(
      reviews.map(async (rev) => {
        const studentDoc = await Student.findById(rev.studentId)
          .select('passportPhoto name surname firstName firstname admissionNo registrationNo currentClass')
          .lean()
          .catch(() => null);

        const displayName = rev.name || 
          (studentDoc ? `${studentDoc.surname || ''} ${studentDoc.firstName || studentDoc.firstname || studentDoc.name || ''}`.trim() : 'Student');
        
        const displayAdm = rev.admissionNo || studentDoc?.admissionNo || studentDoc?.registrationNo || 'N/A';
        const verifiedAverage = Number(rev.overallAverage || 0).toFixed(2);

        return {
          _id: rev.studentId ? rev.studentId.toString() : rev._id.toString(),
          studentId: rev.studentId ? rev.studentId.toString() : rev._id.toString(),
          reviewId: rev._id.toString(),
          name: displayName,
          admissionNo: displayAdm,
          className: rev.className || cleanClass,
          termAverage: verifiedAverage,
          overallAverage: verifiedAverage,
          executiveRemark: rev.principalRemark || rev.teacherRemark || 'Satisfactory academic performance.',
          passportPhoto: studentDoc?.passportPhoto || null,
          status: rev.status
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: formattedReviews.length,
      data: formattedReviews
    });
  } catch (error) {
    console.error('💥 Error in getApprovedExecutiveReviews:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve approved review queue.', 
      error: error.message 
    });
  }
};

/**
 * @route   POST /api/teachers/admin-return-results
 * @desc    Admin returns result back to HM / Principal desk with mandatory audit reason
 */
export const adminReturnClassResults = async (req, res) => {
  try {
    const { reviewId, studentId, className, term, session, reason, returnReason, rejectionReason } = req.body;

    const finalReason = (reason || returnReason || rejectionReason || '').trim();
    if (!finalReason) {
      return res.status(400).json({ 
        success: false, 
        message: 'A specific reason for returning the result is required.' 
      });
    }

    let targetQuery = {};
    if (reviewId && mongoose.Types.ObjectId.isValid(reviewId)) {
      targetQuery._id = reviewId;
    } else if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
      targetQuery.studentId = studentId;
      if (term) targetQuery.term = term.trim();
      if (session) targetQuery.session = session.trim();
    } else if (className && term && session) {
      targetQuery.className = new RegExp(`^${className.trim().replace(/\s+/g, '\\s*')}$`, 'i');
      targetQuery.term = term.trim();
      targetQuery.session = session.trim();
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid target identifier provided for return operation.' 
      });
    }

    const updatedReviews = await ResultReview.updateMany(targetQuery, {
      $set: {
        status: 'Returned for Revision',
        isApprovedByExecutive: false,
        isApprovedByPrincipal: false,
        returnReason: finalReason,
        rejectionReason: finalReason,
        returnedBy: req.user?.name || req.user?.username || 'School Administrator',
        returnedAt: new Date(),
        previousStatus: 'Approved'
      }
    });

    if (className && term && session) {
      const classRegex = new RegExp(`^${className.trim().replace(/\s+/g, '\\s*')}$`, 'i');
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
    }

    return res.status(200).json({
      success: true,
      message: 'Result returned to HM / Principal desk for correction.',
      modifiedCount: updatedReviews.modifiedCount
    });
  } catch (error) {
    console.error('💥 Error in adminReturnClassResults:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to return result.', 
      error: error.message 
    });
  }
};

/**
 * @route   POST /api/teachers/admin-release-results
 * @desc    Admin publishes HM/Principal approved class results to the student portal
 */
export const releaseClassResults = async (req, res) => {
  try {
    const { className, term, session } = req.body;

    if (!className || !term || !session) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide className, term, and session.' 
      });
    }

    const cleanClass = className.trim();
    const classRegex = new RegExp(`^${cleanClass.replace(/\s+/g, '\\s*')}$`, 'i');

    const approvedReviews = await ResultReview.find({
      $or: [{ className: classRegex }, { class: classRegex }],
      term: term.trim(),
      session: session.trim(),
      $and: [
        {
          $or: [
            { status: 'Approved' },
            { status: 'Approved by Principal' },
            { status: 'Approved by Executive' },
            { status: 'Approved By HM' },
            { isApprovedByExecutive: true },
            { isApprovedByPrincipal: true }
          ]
        },
        { status: { $ne: 'Returned for Revision' } },
        { status: { $ne: 'Released' } },
        { status: { $ne: 'Submitted' } }
      ]
    });

    if (approvedReviews.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No approved results ready for publication in this class.' 
      });
    }

    // 🟢 Publish results to student portals without mutating live currentClass prematurely
    for (const review of approvedReviews) {
      await ResultReview.findByIdAndUpdate(review._id, {
        $set: {
          status: 'Released',
          releasedAt: new Date(),
          releasedBy: req.user?.name || req.user?.username || 'Admin User'
        }
      });
    }

    await GradingGrid.updateMany(
      { className: classRegex, term: term.trim(), session: session.trim() },
      { $set: { status: 'Released', releasedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: `Successfully released ${approvedReviews.length} result(s) for ${cleanClass} to portals.`,
      modifiedCount: approvedReviews.length
    });
  } catch (error) {
    console.error('💥 Error releasing results:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to release results.', 
      error: error.message 
    });
  }
};

/**
 * @route   GET /api/teachers/released-history
 * @desc    Fetch published result archives
 */
export const getReleaseHistory = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const { className, term, session } = req.query;
    let query = { status: 'Released' };

    if (className) query.className = new RegExp(`^${className.trim().replace(/\s+/g, '\\s*')}$`, 'i');
    if (term) query.term = term.trim();
    if (session) query.session = session.trim();

    const history = await ResultReview.find(query)
      .populate('studentId', 'passportPhoto name surname firstName admissionNo')
      .sort({ releasedAt: -1 })
      .lean();

    const formattedHistory = history.map(item => ({
      _id: item._id,
      studentId: item.studentId?._id || item.studentId,
      name: item.name || (item.studentId ? `${item.studentId.surname || ''} ${item.studentId.firstName || ''}`.trim() : 'Student'),
      admissionNo: item.admissionNo || item.studentId?.admissionNo || 'N/A',
      className: item.className,
      term: item.term,
      session: item.session,
      overallAverage: Number(item.overallAverage || 0).toFixed(2),
      overallGrade: item.overallGrade || 'N/A',
      releasedAt: item.releasedAt,
      releasedBy: item.releasedBy || 'Admin'
    }));

    return res.status(200).json({
      success: true,
      count: formattedHistory.length,
      data: formattedHistory
    });
  } catch (error) {
    console.error('💥 Error fetching release history:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch release history.', 
      error: error.message 
    });
  }
};

/**
 * @route   GET /api/teachers/search-student-results
 * @desc    Dedicated search utility across result archives
 */
export const searchStudentResults = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const { query: searchQuery, className } = req.query;

    if (!searchQuery || !searchQuery.trim()) {
      return res.status(200).json({ success: true, data: [] });
    }

    const cleanQuery = searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(cleanQuery, 'i');

    let orConditions = [
      { name: searchRegex },
      { admissionNo: searchRegex }
    ];

    if (mongoose.Types.ObjectId.isValid(searchQuery.trim())) {
      orConditions.push({ studentId: searchQuery.trim() });
    }

    let filter = { $or: orConditions };
    if (className) {
      filter.className = new RegExp(`^${className.trim().replace(/\s+/g, '\\s*')}$`, 'i');
    }

    const results = await ResultReview.find(filter)
      .populate('studentId', 'passportPhoto name surname firstName admissionNo')
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean();

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('💥 Error searching student results:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Search execution failed.', 
      error: error.message 
    });
  }
};

/**
 * @route   DELETE /api/teachers/admin-delete-result/:reviewId
 * @desc    Purge orphaned result review and pull student scores directly from GradingGrid
 */
export const deleteResultRecord = async (req, res) => {
  try {
    const { reviewId, id } = req.params;
    const targetId = reviewId || id;
    const { className, term, session, studentId, admissionNo, studentName } = req.query;

    const isMongoId = mongoose.Types.ObjectId.isValid(targetId);

    if (isMongoId) {
      await ResultReview.findByIdAndDelete(targetId).catch(() => null);
    }
    
    if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
      await ResultReview.findOneAndDelete({ studentId }).catch(() => null);
    }

    const pullConditions = [];

    if (targetId && targetId !== 'undefined' && targetId !== 'orphaned') {
      if (isMongoId) pullConditions.push({ _id: new mongoose.Types.ObjectId(targetId) });
      pullConditions.push({ studentId: targetId });
    }

    if (studentId && studentId !== 'undefined') {
      if (mongoose.Types.ObjectId.isValid(studentId)) {
        pullConditions.push({ _id: new mongoose.Types.ObjectId(studentId) });
      }
      pullConditions.push({ studentId });
    }

    if (admissionNo && admissionNo !== 'N/A' && admissionNo !== 'undefined') {
      pullConditions.push({ admissionNo: admissionNo.trim().toUpperCase() });
    }

    if (studentName && studentName !== 'undefined') {
      pullConditions.push({ name: new RegExp(`^${studentName.trim()}$`, 'i') });
    }

    if (pullConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid identification fields provided for deletion."
      });
    }

    const classFilter = {};
    if (className) classFilter.className = new RegExp(`^${className.trim().replace(/\s+/g, '\\s*')}$`, 'i');
    if (term) classFilter.term = term;
    if (session) classFilter.session = session;

    await GradingGrid.updateMany(
      classFilter,
      { $pull: { studentsScores: { $or: pullConditions } } }
    );

    return res.status(200).json({
      success: true,
      message: "Student record purged successfully from queue."
    });

  } catch (error) {
    console.error("💥 Delete endpoint error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};