// routes/teacherRoutes.js
import express from 'express';

// 1. Staff & Executive Management
import { 
  registerStaff, 
  getAllStaff, 
  updateStaff, 
  deleteStaff,
  getExecutiveReviews,
  getSingleStudentReview 
} from '../controllers/staffController.js';

// 2. Grading Grid Matrix
import { 
  fetchGradingGrid, 
  saveGradingGridDraft 
} from '../controllers/gradingController.js';

// 3. Teacher Result Reviews & Submissions
import { 
  getStudentResultReview, 
  saveResultReview, 
  submitBatchClassResults 
} from '../controllers/teacherReviewController.js';

// 4. Executive Approvals & Rejections
import { 
  approveResultByPrincipal, 
  rejectResultByPrincipal 
} from '../controllers/executiveApprovalController.js';

// 5. Student Portal Results & PDF Downloads
import { 
  getStudentPortalResults,
  downloadStudentResultPdf 
} from '../controllers/portalResultController.js';

// 6. Admin Release Desk Controllers
import {
  getApprovedExecutiveReviews,
  releaseClassResults,
  adminReturnClassResults,
  getReleaseHistory,
  searchStudentResults,
  deleteResultRecord
} from '../controllers/adminReleaseController.js';

import { verifyToken, isAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * 🎓 STUDENT PORTAL RESULT ACCESS
 */
router.get('/my-results/:studentId', verifyToken, getStudentPortalResults);

/**
 * 📊 ACADEMIC GRADING MATRIX ROUTES
 */
router.get('/fetch-grid', verifyToken, fetchGradingGrid);
router.post('/save-grid', verifyToken, saveGradingGridDraft);

/**
 * 📋 RESULT REVIEW & APPROVAL WORKFLOW ROUTES
 */
router.get('/review-single', verifyToken, getSingleStudentReview);
router.post('/save-review', verifyToken, saveResultReview);
router.post('/submit-batch-class', verifyToken, submitBatchClassResults);
router.get('/download-result-pdf/:studentId', verifyToken, downloadStudentResultPdf);

/**
 * 🏛️ EXECUTIVE GOVERNANCE & APPROVAL ROUTES
 */
router.get('/executive-reviews', verifyToken, getExecutiveReviews);
router.post('/principal-approve', verifyToken, approveResultByPrincipal);
router.post('/principal-reject', verifyToken, rejectResultByPrincipal);

/**
 * 🚀 ADMIN RELEASE DESK ROUTES
 */
router.get('/admin-approved-reviews', verifyToken, getApprovedExecutiveReviews);
router.post('/admin-release-results', verifyToken, isAdmin, releaseClassResults);
router.post('/admin-return-results', verifyToken, isAdmin, adminReturnClassResults);
router.delete('/admin-delete-result/:reviewId', verifyToken, isAdmin, deleteResultRecord);
router.get('/released-history', verifyToken, isAdmin, getReleaseHistory);
router.get('/search-student-results', verifyToken, searchStudentResults);

/**
 * 👨‍🏫 TEACHER & STAFF MANAGEMENT ROUTES
 */
router.post('/', verifyToken, isAdmin, registerStaff);
router.get('/', verifyToken, isAdmin, getAllStaff);
router.put('/:id', verifyToken, isAdmin, updateStaff);
router.delete('/:id', verifyToken, isAdmin, deleteStaff);

export default router;