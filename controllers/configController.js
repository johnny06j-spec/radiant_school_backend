// controllers/configController.js
import SystemConfig from '../models/SystemConfig.js';

/**
 * @route   GET /api/system/config
 * @desc    Fetch active global academic session & term settings
 * @access  Private (Authenticated Users)
 */
export const getSystemConfig = async (req, res) => {
  try {
    let config = await SystemConfig.findOne({});

    // If no configuration exists yet, seed and persist the initial baseline
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
 * @desc    Update global academic session settings
 * @access  Private (Admin Only)
 */
export const updateSystemConfig = async (req, res) => {
  try {
    const { currentSession, currentTerm } = req.body;

    // Validate parameters cleanly
    if (!currentSession || !currentTerm) {
      return res.status(400).json({
        success: false,
        message: "Please provide both currentSession and currentTerm inputs."
      });
    }

    // Upsert the single global system configuration document
    const updatedConfig = await SystemConfig.findOneAndUpdate(
      {}, // Finds the single configuration record in collection
      { 
        $set: { 
          currentSession: String(currentSession).trim(), 
          currentTerm: String(currentTerm).trim() 
        } 
      },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: `Academic settings successfully updated to ${updatedConfig.currentSession} (${updatedConfig.currentTerm})!`,
      data: updatedConfig
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