// controllers/paymentsController.js
import StudentInvoice from '../models/StudentInvoice.js';
import FeeStructure from '../models/FeeStructure.js';
import Student from '../models/Student.js';

// @desc Fetch or Dynamically Generate a Student's Ledger Sheet for a specific Term
export const getStudentLedger = async (req, res) => {
  try {
    const targetStudentId = req.params.studentId || req.query.studentId || req.user?.id;
    const { className, term, session, studentType, studentName, campus: queryCampus } = req.query;

    if (!targetStudentId) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing studentId parameter." 
      });
    }

    // 🔒 Enforce strict Campus resolution
    let activeCampus = queryCampus || req.user?.campus;
    
    // Fetch student document if metadata (className/campus) is missing from request
    const studentDoc = await Student.findById(targetStudentId)
      .select('name surname firstname firstName currentClass assignedClass campus studentType')
      .lean();

    if (!activeCampus) {
      activeCampus = studentDoc?.campus || 'Emerald Campus';
    }

    const targetClass = className || studentDoc?.currentClass || studentDoc?.assignedClass;
    const resolvedStudentType = studentType || studentDoc?.studentType || 'Returning Students';

    if (!targetClass || !term || !session) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required core query parameters (className, term, session)." 
      });
    }

    // 🔒 Query invoice isolated by campus
    let invoice = await StudentInvoice.findOne({ 
      studentId: targetStudentId, 
      term: term.trim(), 
      session: session.trim(),
      campus: activeCampus 
    });

    if (!invoice) {
      // 🔒 Find FeeStructure for the specific campus
      const masterStructure = await FeeStructure.findOne({ 
        className: targetClass.trim(), 
        term: term.trim(), 
        session: session.trim(), 
        campus: activeCampus,
        status: 'Active' 
      });
      
      if (!masterStructure) {
        return res.status(404).json({ 
          success: false, 
          message: `No active base fee structure layout found for ${targetClass} (${term}) at ${activeCampus}.` 
        });
      }

      const assignedItems = masterStructure.items
        .filter(item => item.checked && (item.appliesTo === 'All Students' || item.appliesTo === resolvedStudentType))
        .map(item => ({ name: item.name, amount: item.amount }));

      const totalAssigned = assignedItems.reduce((sum, item) => sum + item.amount, 0);

      const resolvedName = studentName || studentDoc?.name || `${studentDoc?.firstName || ''} ${studentDoc?.surname || ''}`.trim() || "Unknown Student";

      invoice = await StudentInvoice.create({
        studentId: targetStudentId,
        studentName: resolvedName,
        className: targetClass.trim(),
        campus: activeCampus, // 🔒 Stamped
        term: term.trim(),
        session: session.trim(),
        studentType: resolvedStudentType,
        feeItems: assignedItems,
        totalAssigned,
        totalPaid: 0,
        balanceDue: totalAssigned,
        status: 'Unpaid'
      });
    }

    return res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    console.error("Ledger acquisition failure:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Process Electronic Payment Collection Hook (Bank Transfer / POS)
export const postCollectionPayment = async (req, res) => {
  try {
    const { invoiceId, amountPaid, paymentMethod, reference, adminName } = req.body;

    if (!invoiceId || !amountPaid || !paymentMethod || !reference) {
      return res.status(400).json({ success: false, message: "Missing transaction parameters." });
    }

    const invoice = await StudentInvoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Target student invoice map missing." });
    }

    const parseAmount = Number(amountPaid);
    if (parseAmount <= 0 || parseAmount > invoice.balanceDue) {
      return res.status(400).json({ success: false, message: "Invalid collection payment amount parameters." });
    }

    invoice.payments.push({
      amountPaid: parseAmount,
      paymentMethod,
      reference,
      receivedBy: adminName || req.user?.name || "System Admin"
    });

    invoice.totalPaid += parseAmount;
    invoice.balanceDue = invoice.totalAssigned - invoice.totalPaid;

    if (invoice.balanceDue === 0) {
      invoice.status = 'Fully Paid';
    } else {
      invoice.status = 'Partially Paid';
    }

    await invoice.save();
    return res.status(200).json({ success: true, message: "Payment processed successfully.", data: invoice });
  } catch (error) {
    console.error("Payment registration failure:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};