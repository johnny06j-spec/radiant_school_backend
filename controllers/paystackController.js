// controllers/paystackController.js
import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import Student from '../models/Student.js';
import Payment from '../models/Payment.js'; // Linked to dynamic chronological ledger model

// @desc Initialize Paystack Checkout Payment with Dynamic Subaccount Routing
// @route POST /api/finance/paystack/initialize
export const initializePayment = async (req, res) => {
  try {
    const { studentId, amount, term, session, paymentType, callbackUrl } = req.body;

    if (!studentId || !amount || !term || !session || !paymentType) {
      return res.status(400).json({ success: false, message: "Missing checkout parameters." });
    }

    const student = await Student.findById(studentId).populate('user');
    if (!student) {
      return res.status(404).json({ success: false, message: "Student record not found." });
    }

    const email = student.email || student.user?.email;
    if (!email) {
      return res.status(400).json({ success: false, message: "Student must have a valid email to pay online." });
    }

    // 🎯 Dynamic Bank Subaccount Routing based on Student's Current Class
    const isNurseryOrPrimary = /nursery|primary|basic|kg|crèche|creche|playgroup/i.test(student.currentClass || '');
    
    const targetSubaccount = isNurseryOrPrimary 
      ? process.env.SUBACCOUNT_NURSERY_PRIMARY 
      : process.env.SUBACCOUNT_COLLEGE;

    // Generate unique transaction reference
    const reference = 'RAD-' + Math.random().toString(36).substring(2, 11).toUpperCase() + '-' + Date.now();

    // Paystack expects amount in KOBO
    const amountInKobo = Math.round(Number(amount) * 100);

    // 🟢 Build callback URL that explicitly maintains studentId context on redirect
    const targetCallbackUrl = callbackUrl 
      ? `${callbackUrl}&reference=${reference}`
      : `http://localhost:5173/student?studentId=${studentId}&tab=finance&reference=${reference}`;

    const paystackBody = {
      email,
      amount: amountInKobo,
      reference,
      subaccount: targetSubaccount, // 🎯 Paystack routes 100% of payout directly here!
      callback_url: targetCallbackUrl, // 🟢 Preserves active sibling context!
      metadata: {
        studentId,
        email,
        metadata_amount: amount,
        paymentType,
        term,
        session
      }
    };

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paystackBody)
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ success: false, message: data.message || "Paystack initialization failed." });
    }

    await Transaction.create({
      studentId,
      email,
      amount: Number(amount),
      reference,
      status: 'Pending',
      metadata: { term, session, paymentType }
    });

    res.status(200).json({
      success: true,
      authorization_url: data.data.authorization_url,
      reference
    });

  } catch (error) {
    console.error("💥 Paystack Initialization Exception:", error);
    res.status(500).json({ success: false, message: "Failed to initialize gateway checkout." });
  }
};

// @desc Verify Paystack Transaction Status & Deduct Balance
// @route GET /api/finance/paystack/verify/:reference 
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ success: false, message: "Transaction reference is required." });
    }

    console.log(`🔍 Starting payment verification for reference: ${reference}`);

    // 1. Check if we already processed this transaction as a success
    const existingTx = await Transaction.findOne({ reference });
    if (existingTx && existingTx.status === 'Success') {
      console.log(`ℹ️ Reference ${reference} was already verified previously.`);
      return res.status(200).json({ 
        success: true, 
        message: "Payment already verified successfully.",
        verifiedAmount: existingTx.amount 
      });
    }

    // 2. Query Paystack directly to verify transaction status
    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    });

    const paystackData = await paystackResponse.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      console.error(`❌ Paystack verification failed for reference: ${reference}`);
      return res.status(400).json({ success: false, message: "Payment verification failed on Paystack." });
    }

    // 3. Payment is confirmed! Extract metadata payload
    const { studentId, paymentType, term, session, email } = paystackData.data.metadata;
    const verifiedAmount = paystackData.data.amount / 100; // Convert Kobo back to Naira

    console.log(`💳 Paystack confirmed ₦${verifiedAmount} for student ID: ${studentId}`);

    const student = await Student.findById(studentId);
    if (!student) {
      console.error(`❌ Student with ID ${studentId} not found in database.`);
      return res.status(404).json({ success: false, message: "Student record not found." });
    }

    // 4. Check if ledger record exists inside Payment collection to prevent double entry
    const existingPayment = await Payment.findOne({ reference });
    if (!existingPayment) {
      console.log(`📥 Injecting verified receipt into the ledger Payment collection.`);
      await Payment.create({
        studentId,
        amountPaid: verifiedAmount,
        term: term || "Third Term",
        session: session || "2026/2027",
        paymentMethod: 'Online Gateway Channel',
        reference,
        status: 'Successful' // Ensures visibility filter catches the ledger update
      });
    }

    // 5. Update fallback student parameters if utilized by dashboard views
    student.amountPaid = (student.amountPaid || 0) + verifiedAmount;
    if (student.totalOwed) {
      student.totalOwed = Math.max(0, student.totalOwed - verifiedAmount);
    }
    await student.save();

    // 6. Update or save the master system Transaction logs
    if (existingTx) {
      existingTx.status = 'Success';
      existingTx.amount = verifiedAmount;
      await existingTx.save();
    } else {
      await Transaction.create({
        studentId,
        email: email || paystackData.data.customer.email,
        amount: verifiedAmount,
        reference,
        status: 'Success',
        metadata: { 
          term: term || "Third Term", 
          session: session || "2026/2027", 
          paymentType: paymentType || "term_fees" 
        }
      });
    }

    console.log(`✅ Ledger synchronized successfully for reference: ${reference}`);

    return res.status(200).json({ 
      success: true, 
      message: "Payment successfully verified and student balance updated!",
      verifiedAmount
    });

  } catch (error) {
    console.error("💥 Critical Verification Loop Failure:", error);
    res.status(500).json({ success: false, message: "Failed to verify transaction." });
  }
};

// @desc Paystack Background Webhook Event Handler
// @route POST /api/finance/paystack/webhook
export const paystackWebhook = async (req, res) => {
  try {
    // 1. Verify Paystack Event Signature
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error("⚠️ Invalid Paystack Webhook Signature Received.");
      return res.status(400).send('Invalid signature');
    }

    // Acknowledge receipt to Paystack immediately with a 200 OK
    res.sendStatus(200);

    const event = req.body;

    // 2. Listen specifically for successful charge events
    if (event.event === 'charge.success') {
      const data = event.data;
      const reference = data.reference;
      const verifiedAmount = data.amount / 100; // Convert Kobo to Naira
      const { studentId, term, session, paymentType, email } = data.metadata || {};

      console.log(`⚡ Paystack Webhook Received: Successful payment of ₦${verifiedAmount} [Ref: ${reference}]`);

      if (!studentId) {
        console.warn(`⚠️ Webhook received for reference ${reference} without studentId in metadata.`);
        return;
      }

      // 3. Prevent duplicate ledger entry if already verified by frontend callback
      const existingPayment = await Payment.findOne({ reference });
      if (!existingPayment) {
        console.log(`📥 Webhook injecting payment into Ledger collection [Ref: ${reference}]`);
        await Payment.create({
          studentId,
          amountPaid: verifiedAmount,
          term: term || "Third Term",
          session: session || "2026/2027",
          paymentMethod: 'Online Gateway Channel (Webhook)',
          reference,
          status: 'Successful'
        });

        // 4. Update Student Balance
        const student = await Student.findById(studentId);
        if (student) {
          student.amountPaid = (student.amountPaid || 0) + verifiedAmount;
          if (student.totalOwed) {
            student.totalOwed = Math.max(0, student.totalOwed - verifiedAmount);
          }
          await student.save();
        }
      }

      // 5. Update or Create Master System Transaction Log
      await Transaction.findOneAndUpdate(
        { reference },
        {
          $set: {
            studentId,
            email: email || data.customer.email,
            amount: verifiedAmount,
            status: 'Success',
            metadata: { 
              term: term || "Third Term", 
              session: session || "2026/2027", 
              paymentType: paymentType || "term_fees" 
            }
          }
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Webhook payment reconciliation completed for reference: ${reference}`);
    }

  } catch (error) {
    console.error("💥 Paystack Webhook Exception:", error);
  }
};