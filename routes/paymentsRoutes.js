// routes/paymentRoutes.js
import express from 'express';
import { getStudentLedger, postCollectionPayment } from '../controllers/paymentsController.js';

const router = express.Router();

// This endpoint dynamically fetches or creates the active invoice for the selected student
router.get('/student-ledger', getStudentLedger);
router.post('/collect', postCollectionPayment);

export default router;