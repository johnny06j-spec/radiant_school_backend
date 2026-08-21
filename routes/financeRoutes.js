// routes/financeRoutes.js
import express from 'express';
import { verifyToken, isAdmin } from '../middleware/authMiddleware.js';
import { createAdjustment } from '../controllers/adjustmentController.js';

// Import from modular controllers safely
import { 
  saveFeeStructure, 
  getFeeStructures, 
  toggleStructureStatus, 
  deleteFeeStructure,
  getFinanceDirectory
} from '../controllers/feeController.js';

import { 
  getStudentLedger, 
  processCashlessPayment,
  verifyReceiptAuthenticity
} from '../controllers/ledgerController.js';

import { 
  getGlobalFinanceSummary, 
  getDebtorsList, 
  getDebtorsPdfData 
} from '../controllers/debtorsController.js';

// Import Paystack controllers
import { 
  initializePayment, 
  verifyPayment, 
  paystackWebhook 
} from '../controllers/paystackController.js';

// Import dynamic receipt generation controller
import { generateReceiptPDF } from '../controllers/receiptController.js';

const router = express.Router();

// ⚡ Paystack Background Webhook Route
router.post('/paystack/webhook', paystackWebhook);

// Finance Directory Route
router.get('/directory', verifyToken, getFinanceDirectory);

// Fee Configuration Routes
router.post('/structure', verifyToken, isAdmin, saveFeeStructure);
router.get('/structures', verifyToken, getFeeStructures);
router.patch('/structure/:id/status', verifyToken, isAdmin, toggleStructureStatus);
router.delete('/structure/:id', verifyToken, isAdmin, deleteFeeStructure);

// Ledgers, Cash checkout & Verification
router.get('/student-ledger/:studentId', verifyToken, getStudentLedger);
router.post('/checkout', verifyToken, processCashlessPayment);
router.get('/verify-receipt', verifyToken, verifyReceiptAuthenticity);

// Paystack Gateway Checkout & Verification Routes
router.post('/paystack/initialize', verifyToken, initializePayment);
router.get('/paystack/verify/:reference', verifyToken, verifyPayment);

// Dynamic School Invoice/Receipt Downloads
router.get('/receipt/:reference', verifyToken, generateReceiptPDF);

// Aggregated Summary & Debtors
router.get('/dashboard-summary', verifyToken, getGlobalFinanceSummary);
router.get('/debtors', verifyToken, getDebtorsList);
router.get('/debtors/export-pdf', verifyToken, getDebtorsPdfData);

// Administrative path adjustments
router.post('/adjustment', verifyToken, isAdmin, createAdjustment);

export default router;