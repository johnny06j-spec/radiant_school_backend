// controllers/adjustmentController.js
import Adjustment from '../models/Adjustment.js';
import Student from '../models/Student.js';
import SystemConfig from '../models/SystemConfig.js';

/**
 * @desc    Create a fee adjustment (Discount, Waiver, or Fee Increase) locked to Active System Settings Term
 * @route   POST /api/finance/adjustment
 * @access  Private (Admin/Finance)
 */
export const createAdjustment = async (req, res) => {
  try {
    const { studentId, type, amount, reason, session, term } = req.body;

    if (!studentId || !type || amount === undefined || amount === null || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required adjustment parameters (studentId, type, amount, reason)." 
      });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Adjustment amount must be a valid positive number." 
      });
    }

    if (!['Discount', 'Waiver', 'Fee Increase'].includes(type)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid adjustment type specified. Allowed: Discount, Waiver, Fee Increase." 
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: "Student record profile not found." 
      });
    }

    // 🔒 Enforce active session and term from System Settings (SystemConfig model)
    const settings = await SystemConfig.findOne({}).sort({ createdAt: -1 }).lean();
    const activeSession = (settings?.currentSession || session || '2026/2027').trim();
    const activeTerm = (settings?.currentTerm || term || 'First Term').trim();

    if (!activeSession || !activeTerm) {
      return res.status(400).json({ 
        success: false, 
        message: "Active academic session and term configuration missing in system settings." 
      });
    }

    const adjustment = await Adjustment.create({
      studentId,
      type,
      amount: numericAmount,
      term: activeTerm,       // 🔒 System locked
      session: activeSession, // 🔒 System locked
      reason: reason.trim(),
      issuedBy: req.user?.id || req.user?._id
    });

    return res.status(201).json({
      success: true,
      message: `${type} of ₦${numericAmount.toLocaleString()} successfully committed for ${activeSession} (${activeTerm}).`,
      adjustment
    });

  } catch (error) {
    console.error("💥 Create Adjustment Exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to process fee adjustment record.",
      error: error.message 
    });
  }
};