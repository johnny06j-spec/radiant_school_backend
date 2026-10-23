// routes/attendanceRoutes.js
import express from 'express';
import { 
  getClassAttendanceSheet, 
  saveClassAttendance, 
  getWeeklyReportData, 
  getStudentAttendanceHistory 
} from '../controllers/attendanceController.js';
import { protectTeacher, protectStudent } from '../middleware/authMiddleware.js';

const router = express.Router();

// 🟢 Both /sheet and /class-sheet endpoints mapped safely
router.get('/sheet', protectTeacher, getClassAttendanceSheet);
router.get('/class-sheet', protectTeacher, getClassAttendanceSheet);

router.post('/submit', protectTeacher, saveClassAttendance);
router.post('/save', protectTeacher, saveClassAttendance);

router.get('/weekly-report', protectTeacher, getWeeklyReportData);
router.get('/student-portal', protectStudent, getStudentAttendanceHistory);

export default router;