// routes/attendanceRoutes.js
import express from 'express';
import { 
  getClassAttendanceSheet, 
  saveClassAttendance, 
  getWeeklyReportData, 
  getStudentAttendanceHistory 
} from '../controllers/attendanceController.js';
import { verifyToken, protectTeacher, protectStudent } from '../middleware/authMiddleware.js';

const router = express.Router();

// 🟢 Both /sheet and /class-sheet endpoints mapped safely
router.get('/sheet', verifyToken, protectTeacher, getClassAttendanceSheet);
router.get('/class-sheet', verifyToken, protectTeacher, getClassAttendanceSheet);

router.post('/submit', verifyToken, protectTeacher, saveClassAttendance);
router.post('/save', verifyToken, protectTeacher, saveClassAttendance);

router.get('/weekly-report', verifyToken, protectTeacher, getWeeklyReportData);
router.get('/student-portal', verifyToken, protectStudent, getStudentAttendanceHistory);

export default router;