// controllers/paymentsController.js
import StudentInvoice from '../models/StudentInvoice.js';
import FeeStructure from '../models/FeeStructure.js';

// @desc Fetch or Dynamically Generate a Student's Ledger Sheet for a specific Term
export const getStudentLedger = async (req, res) => {
  try {
    // 🟢 Extract explicit studentId from params or query, falling back to req.user.id
    const targetStudentId = req.params.studentId || req.query.studentId || req.user?.id;
    const { className, term, session, studentType, studentName } = req.query;

    if (!targetStudentId || !className || !term || !session) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required core query parameters (studentId, className, term, session)." 
      });
    }

    let invoice = await StudentInvoice.findOne({ studentId: targetStudentId, term, session });

    if (!invoice) {
      const masterStructure = await FeeStructure.findOne({ className, term, session, status: 'Active' });
      
      if (!masterStructure) {
        return res.status(404).json({ 
          success: false, 
          message: `No active base fee structure layout found on the server for ${className} (${term}). Configure class fees first.` 
        });
      }

      const assignedItems = masterStructure.items
        .filter(item => item.checked && (item.appliesTo === 'All Students' || item.appliesTo === studentType))
        .map(item => ({ name: item.name, amount: item.amount }));

      const totalAssigned = assignedItems.reduce((sum, item) => sum + item.amount, 0);

      invoice = await StudentInvoice.create({
        studentId: targetStudentId,
        studentName: studentName || "Unknown Student",
        className,
        term,
        session,
        studentType: studentType || 'Returning Students',
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
      receivedBy: adminName || "System Admin"
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