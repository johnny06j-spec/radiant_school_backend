// routes/systemRoutes.js
import express from 'express';

// 1. Preserve existing student financial configuration logic from studentController
import { updateSystemConfig as updateStudentFinancialConfig } from '../controllers/studentController.js';

// 2. Import global academic term and session configuration handlers
import { getSystemConfig, updateSystemConfig } from '../controllers/configController.js';

import { verifyToken, isAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// 🟢 GET active global session & term settings
router.get('/config', verifyToken, getSystemConfig);

// 🟢 PUT update global session & term settings (Admin only)
router.put('/config', verifyToken, isAdmin, updateSystemConfig);

// 🟢 PUT update student financial system parameters (Preserved safely)
router.put('/student-config', verifyToken, isAdmin, updateStudentFinancialConfig);

export default router;