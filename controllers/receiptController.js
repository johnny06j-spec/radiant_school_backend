// controllers/receiptController.js
import Payment from '../models/Payment.js';
import Student from '../models/Student.js';
import FeeStructure from '../models/FeeStructure.js';
import Adjustment from '../models/Adjustment.js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import toWords from 'number-to-words';
import path from 'path';
import fs from 'fs';
import { normalizeClassName, isOlderTerm, isStudentEnrolledInTerm } from './financeHelpers.js';

// Helper to convert number amounts to clear currency text
const formatAmountInWords = (amount) => {
  try {
    const integerPart = Math.floor(amount);
    const words = toWords.toWords(integerPart);
    const capitalized = words.replace(/\b\w/g, l => l.toUpperCase());
    return `${capitalized} Naira Only.`;
  } catch (err) {
    return `${amount.toLocaleString()} Naira Only.`;
  }
};

// Helper to safely load the logo image from filesystem
const getLogoPath = () => {
  const possiblePaths = [
    path.join(process.cwd(), 'public', 'assets', 'logo.jpg'),
    path.join(process.cwd(), 'assets', 'logo.jpg'),
    path.join(process.cwd(), 'public', 'logo.jpg'),
    path.join(process.cwd(), 'public', 'assets', 'logo.png')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

// Helper to safely load the proprietor signature image from filesystem
const getSignaturePath = () => {
  const possiblePaths = [
    path.join(process.cwd(), 'public', 'assets', 'signature.png'),
    path.join(process.cwd(), 'assets', 'signature.png'),
    path.join(process.cwd(), 'public', 'assets', 'signature.jpg'),
    path.join(process.cwd(), 'assets', 'signature.jpg')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

// @desc Generate and stream a school-branded PDF receipt with Carry-Over Debt Roll-Over & Itemized Allocation
// @route GET /api/finance/receipt/:reference
export const generateReceiptPDF = async (req, res) => {
  try {
    const { reference } = req.params;

    // 1. Fetch current target payment record
    const payment = await Payment.findOne({ reference }).lean();
    if (!payment) {
      return res.status(404).json({ success: false, message: "Receipt record not found." });
    }

    // 2. Fetch associated student profile
    const student = await Student.findById(payment.studentId).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: "Associated student profile not found." });
    }

    let firstName = student.firstName || "";
    let lastName = student.surname || student.lastName || "";
    let otherName = student.otherName || "";
    const fullName = `${firstName} ${otherName} ${lastName}`.replace(/\s+/g, ' ').trim() || student.name || "Student Profile";

    const paymentTimestamp = payment.createdAt || new Date();
    const studentClass = normalizeClassName(student.currentClass || student.assignedClass || '');

    // 🟢 3. FETCH ALL HISTORICAL SUCCESSFUL PAYMENTS UP TO THIS TRANSACTION
    const allPaymentsUpToNow = await Payment.find({
      studentId: student._id,
      status: 'Successful',
      createdAt: { $lte: paymentTimestamp }
    }).sort({ createdAt: 1 }).lean();

    const grandTotalPaidUpToNow = allPaymentsUpToNow.reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0);
    const amountPaidCurrentTransaction = Number(payment.amountPaid) || 0;

    // 🟢 4. CALCULATE HISTORICAL EXPECTED DEBT ONLY IF ENROLLED IN OLDER TERMS
    const allStructures = await FeeStructure.find({}).lean();
    const adjustments = await Adjustment.find({ studentId: student._id }).lean();

    const totalDiscountsWaivers = adjustments
      .filter(adj => adj.type === 'Discount' || adj.type === 'Waiver')
      .reduce((sum, adj) => sum + (Number(adj.amount) || 0), 0);

    let pastExpectations = 0;
    allStructures.forEach(struct => {
      const isHistorical = isOlderTerm(struct.session, struct.term, payment.session, payment.term);
      
      // Check enrollment helper if available to prevent phantom debts for new students
      const wasEnrolled = typeof isStudentEnrolledInTerm === 'function' 
        ? isStudentEnrolledInTerm(student, struct.session, struct.term)
        : true;

      if (normalizeClassName(struct.className) === studentClass && isHistorical && wasEnrolled) {
        const admittedSession = String(student.admittedSession || student.admissionSession || student.intakeSession || struct.session).trim();
        const studentType = admittedSession === struct.session ? 'New Students' : 'Returning Students';

        struct.items?.forEach(item => {
          if (item.checked !== false && (item.appliesTo === 'All Students' || item.appliesTo === studentType)) {
            pastExpectations += Number(item.amount) || 0;
          }
        });

        // Add fee increases for older terms
        const termIncreases = adjustments.filter(adj => adj.type === 'Fee Increase' && adj.session === struct.session && adj.term === struct.term);
        termIncreases.forEach(adj => { pastExpectations += Number(adj.amount) || 0; });
      }
    });

    const basePreviousOutstanding = Number(student.previousOutstanding) || 0;
    
    // 🟢 Only declare historical debt if base Previous Outstanding exists or actual prior enrollment debt exists
    const totalHistoricalDebt = basePreviousOutstanding + pastExpectations;

    // 🟢 5. FETCH CURRENT TERM FEE STRUCTURE
    let currentTermItems = [];
    const currentStructure = allStructures.find(struct => 
      normalizeClassName(struct.className) === studentClass &&
      struct.session === payment.session &&
      struct.term === payment.term
    );

    if (currentStructure && currentStructure.items) {
      const admittedSession = String(student.admittedSession || student.admissionSession || student.intakeSession || payment.session).trim();
      const studentType = admittedSession === payment.session ? 'New Students' : 'Returning Students';
      
      currentTermItems = currentStructure.items
        .filter(i => i.checked !== false && (i.appliesTo === 'All Students' || i.appliesTo === studentType))
        .map(i => ({
          description: i.name,
          amount: Number(i.amount) || 0
        }));
    }

    const currentTermIncreases = adjustments.filter(adj => adj.type === 'Fee Increase' && adj.session === payment.session && adj.term === payment.term);
    currentTermIncreases.forEach(adj => {
      currentTermItems.push({ description: `[Fee Increase] ${adj.reason}`, amount: Number(adj.amount) || 0 });
    });

    const currentTermExpectedFee = currentTermItems.reduce((sum, item) => sum + item.amount, 0);

    // 🟢 6. CHRONOLOGICAL ALLOCATION ENGINE (PREVIOUS DEBT FIRST, THEN CURRENT TERM)
    let workingCredit = grandTotalPaidUpToNow + totalDiscountsWaivers;
    let itemizedBreakdown = [];

    // Step A: Allocate toward Previous Outstanding Debt ONLY IF totalHistoricalDebt > 0
    if (totalHistoricalDebt > 0) {
      const prevDebtPaid = Math.min(totalHistoricalDebt, workingCredit);
      workingCredit = Math.max(0, workingCredit - totalHistoricalDebt);
      const prevDebtBalance = Math.max(0, totalHistoricalDebt - prevDebtPaid);

      itemizedBreakdown.push({
        description: 'PREVIOUS OUTSTANDING DEBT (Carry-Over)',
        totalAmount: totalHistoricalDebt,
        amountPaid: prevDebtPaid,
        balance: prevDebtBalance
      });
    }

    // Step B: Allocate remaining credit to Current Term Fee Items
    currentTermItems.forEach(item => {
      const itemPaid = Math.min(item.amount, workingCredit);
      workingCredit = Math.max(0, workingCredit - itemPaid);
      const itemBalance = Math.max(0, item.amount - itemPaid);

      itemizedBreakdown.push({
        description: item.description,
        totalAmount: item.amount,
        amountPaid: itemPaid,
        balance: itemBalance
      });
    });

    const totalBillAmount = totalHistoricalDebt + currentTermExpectedFee;
    const totalBalanceDue = Math.max(0, totalBillAmount - (grandTotalPaidUpToNow + totalDiscountsWaivers));

    // 7. Generate QR Code Buffer
    const verifyUrl = `http://localhost:5000/api/finance/verify-receipt?reference=${encodeURIComponent(payment.reference)}`;
    const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 100 });
    const qrBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');

    // 8. Initialize A4 Landscape PDF
    const doc = new PDFDocument({ 
      size: 'A4', 
      layout: 'landscape', 
      margin: 0 
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=Receipt-${reference}.pdf`);

    doc.pipe(res);

    // --- COLOR PALETTE ---
    const NAVY = '#0a192f';
    const GOLD = '#d97706';
    const LIGHT_GOLD = '#fef3c7';
    const GRAY_BG = '#f8fafc';
    const TEXT_DARK = '#0f172a';
    const TEXT_MUTED = '#64748b';
    const RED_ALERT = '#dc2626';

    // --- TOP DECORATIVE GEOMETRY ---
    doc.save()
       .moveTo(480, 0)
       .lineTo(842, 0)
       .lineTo(842, 130)
       .lineTo(440, 130)
       .closePath()
       .fill(NAVY);

    doc.moveTo(435, 130)
       .lineTo(842, 130)
       .lineTo(842, 134)
       .lineTo(430, 134)
       .closePath()
       .fill(GOLD);
    doc.restore();

    // --- HEADER CONTENT (LEFT SIDE) ---
    const logoFile = getLogoPath();
    if (logoFile) {
      doc.image(logoFile, 35, 20, { width: 85 });
    } else {
      doc.save()
         .rect(35, 20, 80, 80)
         .lineWidth(2)
         .strokeColor(NAVY)
         .restore();
    }

    doc.fillColor(NAVY)
       .fontSize(22)
       .font('Helvetica-Bold')
       .text("RADIANT INTELLECTUALS'", 130, 20);

    doc.fontSize(22)
       .fillColor(GOLD)
       .text("COLLEGE", 130, 45);

    doc.fontSize(8)
       .font('Helvetica-Bold')
       .fillColor(NAVY)
       .text("DISCIPLINE   •   KNOWLEDGE   •   EXCELLENCE", 130, 75, { wordSpacing: 2 });

    // --- HEADER CONTENT (RIGHT SIDE) ---
    doc.fillColor('#ffffff')
       .fontSize(8)
       .font('Helvetica')
       .text("Radiant Compound, Ajagunmolu street,", 560, 20)
       .text("Off old ikare road, Owo,", 560, 32)
       .text("Ondo State.", 560, 44)
       .text("0706 467 1744", 560, 60)
       .text("radiantintellectualscollege@gmail.com", 560, 75);

    doc.save()
       .rect(720, 100, 110, 24)
       .fill(GOLD);
    
    doc.fillColor('#ffffff')
       .fontSize(9)
       .font('Helvetica-Bold')
       .text("OFFICIAL RECEIPT", 720, 107, { width: 110, align: 'center' });
    doc.restore();

    // --- METADATA STRIP ---
    const metaY = 105;
    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("RECEIPT REF:", 35, metaY);
    doc.fillColor(RED_ALERT).fontSize(8).font('Helvetica-Bold').text(payment.reference, 105, metaY);

    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("DATE:", 35, metaY + 15);
    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica').text(new Date(payment.createdAt || Date.now()).toLocaleString(), 105, metaY + 15);

    doc.save()
       .roundedRect(300, 98, 200, 22, 11)
       .fill(NAVY);
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text("OFFICIAL RECEIPT", 300, 104, { width: 200, align: 'center' });
    doc.restore();

    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("PAYMENT MODE:", 540, metaY);
    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica').text(payment.paymentMethod || 'Online (Paystack)', 625, metaY);

    // --- STUDENT INFORMATION CARD ---
    const cardY = 135;
    doc.save()
       .roundedRect(35, cardY, 772, 60, 6)
       .lineWidth(1)
       .strokeColor('#fed7aa')
       .fillAndStroke(GRAY_BG, '#fed7aa');

    doc.roundedRect(35, cardY, 80, 60, 6).fill(NAVY);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text("STUDENT", 35, cardY + 18, { width: 80, align: 'center' });
    doc.text("INFORMATION", 35, cardY + 30, { width: 80, align: 'center' });

    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("STUDENT NAME:", 130, cardY + 10);
    doc.font('Helvetica').text(fullName, 225, cardY + 10);

    doc.font('Helvetica-Bold').text("ADMISSION NO.:", 130, cardY + 25);
    doc.font('Helvetica').text(student.admissionNo || student.registrationNo || "N/A", 225, cardY + 25);

    doc.font('Helvetica-Bold').text("CLASS:", 130, cardY + 40);
    doc.font('Helvetica').text(student.currentClass || student.assignedClass || "N/A", 225, cardY + 40);

    doc.moveTo(460, cardY + 8).lineTo(460, cardY + 52).strokeColor('#fdba74').stroke();

    doc.font('Helvetica-Bold').text("ACADEMIC SESSION:", 480, cardY + 15);
    doc.font('Helvetica').text(payment.session, 610, cardY + 15);

    doc.font('Helvetica-Bold').text("TERM:", 480, cardY + 35);
    doc.font('Helvetica').text(payment.term, 610, cardY + 35);
    doc.restore();

    // --- ITEMIZED BREAKDOWN TABLE ---
    const tableY = 205;
    
    doc.save().rect(35, tableY, 772, 20).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text("PAYMENT DETAILS", 50, tableY + 6);
    doc.text("TOTAL AMOUNT (NGN)", 380, tableY + 6, { width: 120, align: 'right' });
    doc.text("CUMULATIVE PAID (NGN)", 530, tableY + 6, { width: 130, align: 'right' });
    doc.text("BALANCE (NGN)", 680, tableY + 6, { width: 110, align: 'right' });
    doc.restore();

    let currentY = tableY + 20;
    itemizedBreakdown.forEach((item, index) => {
      doc.save();
      if (index % 2 === 0) {
        doc.rect(35, currentY, 772, 18).fill('#ffffff');
      } else {
        doc.rect(35, currentY, 772, 18).fill(GRAY_BG);
      }
      
      doc.moveTo(35, currentY + 18).lineTo(807, currentY + 18).lineWidth(0.5).strokeColor('#e2e8f0').stroke();

      doc.fillColor(item.description.includes('PREVIOUS') ? RED_ALERT : TEXT_DARK).fontSize(8).font('Helvetica-Bold');
      doc.text(`${index + 1}.`, 50, currentY + 5);
      doc.text(item.description, 140, currentY + 5);
      
      doc.font('Helvetica');
      doc.text(item.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }), 380, currentY + 5, { width: 120, align: 'right' });
      doc.text(item.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 }), 530, currentY + 5, { width: 130, align: 'right' });
      
      doc.fillColor(item.balance > 0 ? RED_ALERT : TEXT_DARK);
      doc.text(item.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }), 680, currentY + 5, { width: 110, align: 'right' });
      
      doc.restore();
      currentY += 18;
    });

    const minTableRowsHeight = 60;
    const actualHeight = currentY - (tableY + 20);
    if (actualHeight < minTableRowsHeight) {
      currentY += (minTableRowsHeight - actualHeight);
    }

    // --- TABLE TOTALS FOOTER ---
    doc.save()
       .rect(35, currentY, 772, 22)
       .fill('#f1f5f9');

    doc.moveTo(35, currentY).lineTo(807, currentY).lineWidth(1).strokeColor('#cbd5e1').stroke();
    doc.moveTo(35, currentY + 22).lineTo(807, currentY + 22).lineWidth(1).strokeColor('#cbd5e1').stroke();

    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("TOTALS", 50, currentY + 7);
    doc.text(`NGN ${totalBillAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 380, currentY + 7, { width: 120, align: 'right' });
    doc.text(`NGN ${grandTotalPaidUpToNow.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 530, currentY + 7, { width: 130, align: 'right' });

    doc.fillColor(totalBalanceDue > 0 ? RED_ALERT : TEXT_DARK);
    doc.text(`NGN ${totalBalanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 680, currentY + 7, { width: 110, align: 'right' });
    doc.restore();

    // --- AMOUNT IN WORDS & SUMMARY CARDS ---
    const summaryY = currentY + 30;
    
    // Amount in words box
    doc.save()
       .roundedRect(35, summaryY, 360, 28, 4)
       .lineWidth(1)
       .strokeColor('#fde68a')
       .fillAndStroke(LIGHT_GOLD, '#fde68a');

    doc.fillColor(TEXT_DARK).fontSize(7).font('Helvetica-Bold').text("AMOUNT IN WORDS:", 43, summaryY + 4);
    doc.fontSize(8).font('Helvetica-Oblique').text(formatAmountInWords(amountPaidCurrentTransaction), 43, summaryY + 15);

    // 3 Summary Metric Blocks
    doc.rect(405, summaryY, 130, 28).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text("AMOUNT PAID", 405, summaryY + 4, { width: 130, align: 'center' });
    doc.fontSize(10).text(`NGN ${amountPaidCurrentTransaction.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 405, summaryY + 14, { width: 130, align: 'center' });

    doc.rect(540, summaryY, 130, 28).fill(RED_ALERT);
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text("TOTAL BALANCE", 540, summaryY + 4, { width: 130, align: 'center' });
    doc.fontSize(10).text(`NGN ${totalBalanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 540, summaryY + 14, { width: 130, align: 'center' });

    doc.rect(675, summaryY, 132, 28).fill(GOLD);
    doc.fillColor(NAVY).fontSize(7).font('Helvetica-Bold').text("TOTAL AMOUNT DUE", 675, summaryY + 4, { width: 132, align: 'center' });
    doc.fontSize(10).text(`NGN ${totalBillAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 675, summaryY + 14, { width: 132, align: 'center' });
    doc.restore();

    // --- FOOTER VERIFICATION & SIGNATURE AREA ---
    const footerY = summaryY + 42;

    doc.save().circle(50, footerY + 12, 12).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(10).text("✓", 46, footerY + 8);
    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("Thank you for your payment.", 70, footerY + 4);
    doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text("Your commitment to education makes a difference.", 70, footerY + 15);

    // Verified badge
    doc.save()
       .circle(320, footerY + 15, 18)
       .lineWidth(1.5)
       .strokeColor('#10b981')
       .stroke();
    doc.fillColor('#10b981').fontSize(6).font('Helvetica-Bold').text("VERIFIED", 302, footerY + 13, { width: 36, align: 'center' });

    // QR Code
    doc.image(qrBuffer, 385, footerY - 5, { width: 45 });
    doc.fillColor(TEXT_DARK).fontSize(7).font('Helvetica-Bold').text("SCAN TO VERIFY", 440, footerY + 8);
    doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text("this receipt online.", 440, footerY + 18);

    // Proprietor signature integration
    const signatureFile = getSignaturePath();
    if (signatureFile) {
      doc.image(signatureFile, 650, footerY - 18, { width: 90 });
    }

    doc.moveTo(630, footerY + 22).lineTo(770, footerY + 22).lineWidth(1).strokeColor('#cbd5e1').stroke();
    doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text("PROPRIETOR", 630, footerY + 26, { width: 140, align: 'center' });

    // --- BOTTOM FOOTER STRIP ---
    const bottomBarY = 570;
    doc.rect(0, bottomBarY, 842, 25).fill(NAVY);
    doc.fillColor('#ffffff').fontSize(7).font('Helvetica').text("This is a computer generated receipt and does not require a physical signature.", 35, bottomBarY + 8);
    doc.fillColor(GOLD).fontSize(7).font('Helvetica-Bold').text("Powered by Radiant Intellectuals' College School Management System", 480, bottomBarY + 8, { width: 325, align: 'right' });

    doc.end();

  } catch (error) {
    console.error("💥 PDF Generation Loop Failure Exception:", error);
    res.status(500).json({ success: false, message: "Failed to generate dynamic receipt PDF." });
  }
};