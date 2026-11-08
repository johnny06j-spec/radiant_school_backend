// controllers/student/systemConfigController.js
import SystemConfig from '../../models/SystemConfig.js';
import ResultReview from '../../models/ResultReview.js';
import Student from '../../models/Student.js';

/**
 * @route   PUT /api/system/config
 * @desc    Update global academic session settings and execute academic rollover
 * @access  Private (Admin Only)
 */
export const updateSystemConfig = async (req, res) => {
  try {
    const { currentSession, currentTerm } = req.body || {};

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

    if (isNewSession) {
      const oldSession = previousConfig.currentSession;

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
      message: error.message || "Internal server error updating system configurations.", 
      error: error.message 
    });
  }
};