// controllers/configController.js
import SystemConfig from '../models/SystemConfig.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import ResultReview from '../models/ResultReview.js';

/**
 * @route   GET /api/system/config
 * @desc    Fetch active global academic session & term settings
 * @access  Private (Authenticated Users)
 */
export const getSystemConfig = async (req, res) => {
  try {
    let config = await SystemConfig.findOne({});

    if (!config) {
      config = await SystemConfig.create({
        currentSession: "2026/2027",
        currentTerm: "First Term"
      });
    }

    return res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error("💥 System configuration fetch exception:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching system configuration.",
      error: error.message
    });
  }
};

/**
 * @route   PUT /api/system/config
 * @desc    Update global academic session settings & perform automated student promotions on session rollover
 * @access  Private (Admin Only)
 */
export const updateSystemConfig = async (req, res) => {
  try {
    const { currentSession, currentTerm } = req.body;

    if (!currentSession || !currentTerm) {
      return res.status(400).json({
        success: false,
        message: "Please provide both currentSession and currentTerm inputs."
      });
    }

    const previousConfig = await SystemConfig.findOne({});
    const isNewSessionRollover = previousConfig && previousConfig.currentSession !== String(currentSession).trim();

    // 1. Update system config
    const updatedConfig = await SystemConfig.findOneAndUpdate(
      {},
      { 
        $set: { 
          currentSession: String(currentSession).trim(), 
          currentTerm: String(currentTerm).trim() 
        } 
      },
      { new: true, upsert: true, runValidators: true }
    );

    let promotedCount = 0;

    // 2. Automated Class Promotion on Session Advance (e.g. from 2026/2027 -> 2027/2028)
    if (isNewSessionRollover) {
      const pastSession = previousConfig.currentSession;
      
      // Fetch all approved Third Term reviews from the concluding session
      const approvedThirdTermReviews = await ResultReview.find({
        session: pastSession,
        term: /third/i,
        promotionDecision: 'PROMOTED',
        promotedToClass: { $exists: true, $ne: '' }
      }).lean();

      for (const review of approvedThirdTermReviews) {
        if (!review.studentId) continue;

        const nextClass = review.promotedToClass.trim();
        const isGraduating = /graduate/i.test(nextClass);

        const updatePayload = {
          currentClass: nextClass,
          assignedClass: nextClass,
          status: isGraduating ? 'Graduated' : 'Active'
        };

        const updatedStudent = await Student.findByIdAndUpdate(
          review.studentId,
          { $set: updatePayload },
          { new: true }
        );

        if (updatedStudent && updatedStudent.user) {
          await User.findByIdAndUpdate(updatedStudent.user, {
            $set: { assignedClass: nextClass, status: isGraduating ? 'Graduated' : 'Active' }
          });
        }

        promotedCount++;
      }
    }

    const promoMessage = promotedCount > 0 
      ? ` and promoted ${promotedCount} students to their new class tiers!` 
      : '!';

    return res.status(200).json({
      success: true,
      message: `Academic settings updated to ${updatedConfig.currentSession} (${updatedConfig.currentTerm})${promoMessage}`,
      data: updatedConfig,
      promotedStudentsCount: promotedCount
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