// routes/authRoutes.js
import express from 'express';
// 🔑 Cloud storage engine middleware for passport photo uploads
import { uploadPassport } from '../config/cloudinary.js'; 
import { 
  loginUser, 
  registerStudent, 
  getAllStudents,
  getDashboardStats,
  updatePassword 
} from '../controllers/authController.js';

// 🛡️ JWT authorization gate middleware
import { verifyToken, isAdmin } from '../middleware/authMiddleware.js';
import User from '../models/User.js';

const router = express.Router();

// 🔐 Public login endpoint (Accessible by all roles to establish session)
router.post('/login', loginUser);

// 👤 Live Profile Refresh Endpoint (Fetch current MongoDB user state)
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    return res.status(200).json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 🚀 Secured student registration endpoint (Restricted to logged-in admins)
router.post(
  '/register-student', 
  verifyToken, 
  isAdmin, 
  uploadPassport.single('passportPhoto'), 
  registerStudent
);

// 👥 Enrolled Students Directory (Accessible by logged-in Staff & Admin)
router.get('/students', verifyToken, getAllStudents);

// 📈 Live Dashboard Stats Overview Route (Restricted to logged-in admins)
router.get('/dashboard-stats', verifyToken, isAdmin, getDashboardStats);

// 🔄 Security Credential Upgrade Route (Requires an active user session)
router.put('/update-password', verifyToken, updatePassword);

export default router;