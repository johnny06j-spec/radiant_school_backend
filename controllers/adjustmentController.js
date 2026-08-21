// controllers/adjustmentController.js
import Adjustment from '../models/Adjustment.js';
import Student from '../models/Student.js';
import SystemConfig from '../models/SystemConfig.js';

// @desc Create a fee adjustment (Discount, Waiver, or Increase) locked to Active System Settings Term
// @route POST /api/finance/adjustment
export const createAdjustment = async (req, res) => {
  try {
    const { studentId, type, amount, reason } = req.body;

    if (!studentId || !type || !amount || !reason) {
      return res.status(400).json({ success: false, message: "Missing required adjustment parameters." });
    }

    if (!['Discount', 'Waiver', 'Fee Increase'].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid adjustment type specified." });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: "Student record profile not found." });
    }

    // 🔒 Enforce active session and term from System Settings (SystemConfig model)
    const settings = await SystemConfig.findOne({}).lean();
    const activeSession = settings?.currentSession || req.body.session;
    const activeTerm = settings?.currentTerm || req.body.term;

    if (!activeSession || !activeTerm) {
      return res.status(400).json({ 
        success: false, 
        message: "Active academic session and term configuration missing in system settings." 
      });
    }

    const adjustment = await Adjustment.create({
      studentId,
      type,
      amount: Number(amount),
      term: activeTerm,       // 🔒 System locked
      session: activeSession, // 🔒 System locked
      reason,
      issuedBy: req.user?.id || req.user?._id
    });

    return res.status(201).json({
      success: true,
      message: `${type} of ₦${Number(amount).toLocaleString()} successfully committed for ${activeSession} (${activeTerm}).`,
      adjustment
    });

  } catch (error) {
    console.error("💥 Create Adjustment Exception:", error);
    return res.status(500).json({ success: false, message: "Failed to process fee adjustment record." });
  }
};