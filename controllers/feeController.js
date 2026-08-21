// controllers/feeController.js
import FeeStructure from '../models/FeeStructure.js';
import SystemConfig from '../models/SystemConfig.js';
import Student from '../models/Student.js';
import { normalizeClassName } from './financeHelpers.js';

// @desc Create or update a class fee layout configuration matrix locked to Active System Settings
// @route POST /api/finance/structure
export const saveFeeStructure = async (req, res) => {
  try {
    const { className, items } = req.body;

    if (!className || className === 'Select Class') {
      return res.status(400).json({ success: false, message: "Please select a valid school class level." });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Fee structure must contain at least one fee item." });
    }

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

    // 🔒 2. UPSERT STRUCTURE LOCKED STRICTLY TO ACTIVE SESSION & TERM
    const structure = await FeeStructure.findOneAndUpdate(
      {
        className: normalizedClass,
        session: activeSession, // 🔒 System locked
        term: activeTerm        // 🔒 System locked
      },
      {
        className: normalizedClass,
        session: activeSession,
        term: activeTerm,
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
      message: `Fee structure for ${normalizedClass} (${activeSession} - ${activeTerm}) committed successfully!`,
      data: structure
    });
  } catch (error) {
    console.error("Save fee structure transaction failure:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Fetch all saved fee configurations (Optionally filtered by query params)
// @route GET /api/finance/structures
export const getFeeStructures = async (req, res) => {
  try {
    const { session, term, className } = req.query;
    
    let filter = {};
    if (session) filter.session = session;
    if (term) filter.term = term;
    if (className) filter.className = normalizeClassName(className);

    const structures = await FeeStructure.find(filter).sort({ createdAt: -1 });
    
    const normalizedStructures = structures.map(struct => {
      const doc = struct.toObject();
      if (doc.totalAmount === undefined || doc.totalAmount === null) {
        doc.totalAmount = (doc.items || [])
          .filter(item => item.checked !== false)
          .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      }
      return doc;
    });

    res.status(200).json({ success: true, data: normalizedStructures });
  } catch (error) {
    console.error("Fetch fee structures logs exception:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Toggle status between Active and Inactive configurations
// @route PATCH /api/finance/structure/:id/status
export const toggleStructureStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedStructure = await FeeStructure.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!updatedStructure) {
      return res.status(404).json({ success: false, message: "Target fee structure block not found." });
    }

    res.status(200).json({ success: true, data: updatedStructure });
  } catch (error) {
    console.error("Toggle structure status fault:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Completely purge a fee structure
// @route DELETE /api/finance/structure/:id
export const deleteFeeStructure = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedStructure = await FeeStructure.findByIdAndDelete(id);

    if (!deletedStructure) {
      return res.status(404).json({ success: false, message: "Fee configuration block targets are already clear." });
    }

    res.status(200).json({ 
      success: true, 
      message: "Fee configuration layout dropped clean." 
    });
  } catch (error) {
    console.error("Deletion system transaction failure:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Fetch student payment directory list for the Finance Desk
// @route GET /api/finance/directory
export const getFinanceDirectory = async (req, res) => {
  try {
    const { session, term, className, search } = req.query;

    let query = {
      $or: [
        { status: { $in: ['Active', 'active', null] } },
        { status: { $exists: false } }
      ]
    };

    if (className && className !== 'All Classes' && className !== 'All') {
      const normalized = normalizeClassName(className);
      query.$and = [
        {
          $or: [
            { currentClass: new RegExp(`^${normalized}$`, 'i') },
            { assignedClass: new RegExp(`^${normalized}$`, 'i') }
          ]
        }
      ];
    }

    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      const searchConditions = [
        { surname: searchRegex },
        { lastName: searchRegex },
        { firstName: searchRegex },
        { name: searchRegex },
        { admissionNo: searchRegex }
      ];

      if (query.$and) {
        query.$and.push({ $or: searchConditions });
      } else {
        query.$and = [{ $or: searchConditions }];
      }
    }

    const students = await Student.find(query).lean();

    if (!students || students.length === 0) {
      return res.status(200).json({ success: true, data: [], total: 0 });
    }

    const formattedDirectory = students.map(student => {
      let displayName = "Active Student";
      if (student.name && typeof student.name === 'string') {
        displayName = student.name.trim();
      } else {
        const first = student.firstName || "";
        const last = student.surname || student.lastName || "";
        displayName = `${first} ${last}`.trim() || "Active Student";
      }

      const displayAdm = student.admissionNo || student.registrationNo || "N/A";
      const studentClass = student.currentClass || student.assignedClass || "Unassigned";

      return {
        _id: student._id,
        studentId: student._id,
        name: displayName,
        admissionNo: displayAdm,
        className: studentClass,
        expectedFees: Number(student.paymentProfile?.expectedFees) || 0,
        amountPaid: Number(student.paymentProfile?.amountPaid) || 0,
        outstandingBalance: Number(student.paymentProfile?.outstandingBalance) || Number(student.previousOutstanding) || 0,
        paymentStatus: student.paymentProfile?.paymentStatus || 'UNPAID'
      };
    });

    return res.status(200).json({
      success: true,
      data: formattedDirectory,
      total: formattedDirectory.length
    });

  } catch (error) {
    console.error("💥 Error fetching finance directory:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load financial directory.",
      error: error.message
    });
  }
};