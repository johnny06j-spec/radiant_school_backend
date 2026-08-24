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

    const trimmedSession = String(currentSession).trim();
    const trimmedTerm = String(currentTerm).trim();

    const previousConfig = await SystemConfig.findOne({});
    const isNewSessionRollover = previousConfig && previousConfig.currentSession !== trimmedSession;

    // 1. Update system config
    const updatedConfig = await SystemConfig.findOneAndUpdate(
      {},
      { 
        $set: { 
          currentSession: trimmedSession, 
          currentTerm: trimmedTerm 
        } 
      },
      { new: true, upsert: true, runValidators: true }
    );

    let promotedCount = 0;
    let repeatCount = 0;

    // 2. Automated Class Promotion ONLY on Academic Session Advance (e.g., 2026/2027 -> 2027/2028)
    if (isNewSessionRollover) {
      const pastSession = previousConfig.currentSession;
      
      // Fetch all approved/published Third Term reviews from the concluding session
      const approvedReviews = await ResultReview.find({
        session: pastSession,
        term: /third/i,
        $or: [
          { isApprovedByExecutive: true },
          { isApprovedByPrincipal: true },
          { status: /approved|released|published/i }
        ]
      }).lean();

      for (const review of approvedReviews) {
        if (!review.studentId) continue;

        const isPromoted = review.promotionDecision === 'PROMOTED' && review.promotedToClass;
        const isRepeat = review.promotionDecision === 'REPEAT';

        if (isPromoted) {
          const nextClass = review.promotedToClass.trim();
          const isGraduating = /graduate/i.test(nextClass);

          const studentUpdate = {
            currentClass: nextClass,
            assignedClass: nextClass,
            academicSession: trimmedSession,
            academicTerm: trimmedTerm,
            enrollmentType: 'Returning Student',
            status: isGraduating ? 'Graduated' : 'Active'
          };

          const updatedStudent = await Student.findByIdAndUpdate(
            review.studentId,
            { $set: studentUpdate },
            { new: true }
          );

          if (updatedStudent?.user) {
            await User.findByIdAndUpdate(updatedStudent.user, {
              $set: { 
                assignedClass: nextClass, 
                status: isGraduating ? 'Graduated' : 'Active' 
              }
            });
          }

          promotedCount++;
        } else if (isRepeat) {
          // Repeating student remains in their current class, updated for the new session
          await Student.findByIdAndUpdate(
            review.studentId,
            { 
              $set: { 
                academicSession: trimmedSession,
                academicTerm: trimmedTerm,
                enrollmentType: 'Returning Student'
              } 
            }
          );
          repeatCount++;
        }
      }
    }

    let message = `Academic settings updated to ${updatedConfig.currentSession} (${updatedConfig.currentTerm}).`;
    if (promotedCount > 0 || repeatCount > 0) {
      message += ` Rollover complete: ${promotedCount} promoted, ${repeatCount} repeated.`;
    }

    return res.status(200).json({
      success: true,
      message,
      data: updatedConfig,
      promotedStudentsCount: promotedCount,
      repeatedStudentsCount: repeatCount
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