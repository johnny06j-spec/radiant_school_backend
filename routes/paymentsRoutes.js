// routes/paymentRoutes.js
import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { getStudentLedger, postCollectionPayment } from '../controllers/paymentsController.js';

const router = express.Router();

// Dynamically fetch or create active invoice context for student
router.get('/student-ledger', verifyToken, getStudentLedger);
router.post('/collect', verifyToken, postCollectionPayment);

export default router;