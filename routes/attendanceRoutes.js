// routes/attendanceRoutes.js
import express from 'express';
import { getClassAttendanceSheet, submitClassAttendance } from '../controllers/attendanceController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/sheet', verifyToken, getClassAttendanceSheet);
router.post('/submit', verifyToken, submitClassAttendance);

export default router;