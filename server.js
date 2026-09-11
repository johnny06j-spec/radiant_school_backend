// server.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import studentRoutes from './routes/studentRoutes.js'; 
import financeRoutes from './routes/financeRoutes.js';
import systemRoutes from './routes/systemRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';

// Import models for backfilling legacy documents
import Student from './models/Student.js';
import User from './models/User.js';
import FeeStructure from './models/FeeStructure.js'; // 👈 Added FeeStructure model

dotenv.config();
const app = express();

// 1. Dynamic CORS whitelist for Localhost + Production Frontend
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
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

// 2. Safe Pre-Flight OPTIONS handler
app.options('/*splat', cors());

// 3. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      { $or: [{ campus: { $exists: false } }, { campus: null }, { campus: '' }] },
      { $set: { campus: 'Emerald Campus' } }
    );

    const userRes = await User.updateMany(
      { $or: [{ campus: { $exists: false } }, { campus: null }, { campus: '' }] },
      { $set: { campus: 'Emerald Campus' } }
    );

    // 🔒 Backfill legacy fee structures missing campus field
    const feeRes = await FeeStructure.updateMany(
      { $or: [{ campus: { $exists: false } }, { campus: null }, { campus: '' }] },
      { $set: { campus: 'Emerald Campus' } }
    );

    if (studentRes.modifiedCount > 0 || userRes.modifiedCount > 0 || feeRes.modifiedCount > 0) {
      console.log(`✅ Legacy Campus Backfill: Assigned 'Emerald Campus' to ${studentRes.modifiedCount} students, ${userRes.modifiedCount} staff members, and ${feeRes.modifiedCount} fee structures.`);
    }
  } catch (err) {
    console.error('⚠️ Campus backfill execution notice:', err.message);
  }
};

// 4. Connect to MongoDB and start the server safely
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