// routes/studentRoutes.js
import express from 'express';
import { 
  getStudentProfile, 
  getAllStudents, 
  getStudentById, 
  updateStudent, 
  deleteStudent,
  linkSibling,
  unlinkSibling 
} from '../controllers/studentController.js';
import { verifyToken as authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/students/profile/me
 * @desc    Fetch logged-in student profile & ledger metrics
 * @access  Private (Student)
 */
router.get('/profile/me', authMiddleware, getStudentProfile);

/**
 * @route   GET /api/students/profile/:id
 * @desc    Fetch specific student profile context (for multi-child profile switching)
 * @access  Private (Student/Admin)
 */
router.get('/profile/:id', authMiddleware, getStudentProfile);

/**
 * @route   POST /api/students/link-sibling
 * @desc    Link a sibling student profile using Admission Number/Username & Password
 * @access  Private (Student)
 */
router.post('/link-sibling', authMiddleware, linkSibling);

/**
 * @route   POST /api/students/unlink-sibling
 * @desc    Unlink a sibling profile from the student's portal
 * @access  Private (Student)
 */
router.post('/unlink-sibling', authMiddleware, unlinkSibling);

/**
 * @route   GET /api/students
 * @desc    Fetch all students (Search & filterable)
 * @access  Private (Admin/Staff)
 */
router.get('/', authMiddleware, getAllStudents);

/**
 * @route   GET /api/students/:id
 * @desc    Fetch a single student document by ID
 * @access  Private (Admin)
 */
router.get('/:id', authMiddleware, getStudentById);

/**
 * @route   PUT /api/students/:id
 * @desc    Update an existing student record
 * @access  Private (Admin)
 */
router.put('/:id', authMiddleware, updateStudent);

/**
 * @route   DELETE /api/students/:id
 * @desc    Delete a student record permanently
 * @access  Private (Admin)
 */
router.delete('/:id', authMiddleware, deleteStudent);

export default router;