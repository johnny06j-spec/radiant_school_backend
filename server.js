// server.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/authRoutes.js';
import studentRoutes from './routes/studentRoutes.js'; 
import financeRoutes from './routes/financeRoutes.js';
import systemRoutes from './routes/systemRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';

// Import models for backfilling legacy documents
import Student from './models/Student.js';
import User from './models/User.js';
import FeeStructure from './models/FeeStructure.js';

dotenv.config();

// 🔒 CRITICAL: Enforce strong JWT_SECRET requirement on startup
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET environment variable must be set and at least 32 characters long.");
  process.exit(1);
}

const app = express();

// 🛡️ 1. Trust Render reverse proxy for rate limiting and secure cookie headers
app.set('trust proxy', 1);

// 🛡️ 2. Apply Helmet security headers & Cookie Parser
app.use(helmet());
app.use(cookieParser());

// 🛡️ 3. Dynamic CORS whitelist for Localhost + Production Frontend
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://portal.radiantintellectualscollege.com',
  process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Safe Pre-Flight OPTIONS handler
app.options('/*splat', cors());

// 💳 Paystack raw body parser placeholder (Must be BEFORE express.json)
// app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), handlePaystackWebhook);

// 🛡️ 4. Restrict JSON Payload Size
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 🛡️ 5. No-Cache Header Middleware for API responses
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

// 🛡️ 6. Login Rate Limiter (Max 10 attempts per 15 mins per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' }
});
app.use('/api/auth/login', authLimiter);

// ─── MAIN APPLICATION ROUTE MAP ───
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes); 
app.use('/api/finance', financeRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/attendance', attendanceRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: "Database connection pipeline online" });
});

// 🟢 ONE-TIME LEGACY CAMPUS BACKFILL SCRIPT
const backfillLegacyCampus = async () => {
  try {
    const studentRes = await Student.updateMany(
      { $or: [{ campus: {$exists: false } }, { campus: null }, { campus: '' }] },
      { $set: { campus: 'Emerald Campus' } }
    );

    const userRes = await User.updateMany(
      { $or: [{ campus: {$exists: false } }, { campus: null }, { campus: '' }] },
      { $set: { campus: 'Emerald Campus' } }
    );

    const feeRes = await FeeStructure.updateMany(
      { $or: [{ campus: {$exists: false } }, { campus: null }, { campus: '' }] },
      { $set: { campus: 'Emerald Campus' } }
    );

    if (studentRes.modifiedCount > 0 || userRes.modifiedCount > 0 || feeRes.modifiedCount > 0) {
      console.log(`✅ Legacy Campus Backfill: Assigned 'Emerald Campus' to ${studentRes.modifiedCount} students, ${userRes.modifiedCount} staff members, and ${feeRes.modifiedCount} fee structures.`);
    }
  } catch (err) {
    console.error('⚠️ Campus backfill execution notice:', err.message);
  }
};

// 🛡️ 7. Centralized Error Handler (Hides internal stack traces in production)
app.use((err, req, res, next) => {
  console.error('Unhandled System Exception:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'An internal system error occurred.' 
      : err.message
  });
});

// Connect to MongoDB and start the server safely
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('🚀 Connected smoothly to MongoDB Atlas Cluster');
    
    // Execute legacy document migration on startup
    await backfillLegacyCampus();

    app.listen(PORT, () => console.log(`Server executing safely on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ Database pipeline connection failure:', err.message);
  });