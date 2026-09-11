// controllers/feeController.js
import FeeStructure from '../models/FeeStructure.js';
import SystemConfig from '../models/SystemConfig.js';
import Student from '../models/Student.js';
import { normalizeClassName } from './financeHelpers.js';

export const saveFeeStructure = async (req, res) => {
  try {
    const { className, items, campus, targetCampus: payloadTargetCampus } = req.body;

    if (!className || className === 'Select Class') {
      return res.status(400).json({ success: false, message: "Please select a valid school class level." });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Fee structure must contain at least one fee item." });
    }

    // 🟢 SANITIZE CAMPUS INPUT (IGNORE "All Campuses")
    let rawCampus = payloadTargetCampus || campus;
    if (Array.isArray(rawCampus)) {
      rawCampus = rawCampus[0];
    } else if (typeof rawCampus === 'string' && rawCampus.includes(',')) {
      rawCampus = rawCampus.split(',')[0];
    }

    let finalCampus = (rawCampus && String(rawCampus).trim() !== '' && rawCampus !== 'All Campuses') 
      ? String(rawCampus).trim() 
      : 'Emerald Campus';

    // 🔒 1. FETCH AND ENFORCE ACTIVE SESSION & TERM FROM SYSTEM CONFIG
    const settings = await SystemConfig.findOne({}).lean();
    const activeSession = settings?.currentSession || req.body.session;
    const activeTerm = settings?.currentTerm || req.body.term;

    if (!activeSession || !activeTerm) {
      return res.status(400).json({
        success: false,
        message: "Active academic session and term configuration missing in system settings."
      });
    }

    const normalizedClass = normalizeClassName(className);

    // Calculate total amount for checked items
    const totalAmount = items
      .filter(item => item.checked !== false)
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    // 🔒 2. UPSERT STRUCTURE LOCKED TO ACTIVE SESSION, TERM & TARGET CAMPUS
    const structure = await FeeStructure.findOneAndUpdate(
      {
        className: normalizedClass,
        session: activeSession,
        term: activeTerm,
        campus: finalCampus
      },
      {
        className: normalizedClass,
        session: activeSession,
        term: activeTerm,
        campus: finalCampus,
        items: items.map(i => ({
          name: i.name.trim(),
          amount: Number(i.amount) || 0,
          checked: i.checked ?? true,
          appliesTo: i.appliesTo?.trim() || 'All Students'
        })),
        totalAmount,
        status: 'Active'
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: `Fee structure for ${normalizedClass} - ${finalCampus} (${activeSession} - ${activeTerm}) committed successfully!`,
      data: structure
    });
  } catch (error) {
    console.error("Save fee structure transaction failure:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Leave getFeeStructures, toggleStructureStatus, deleteFeeStructure, and getFinanceDirectory unchanged