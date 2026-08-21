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

dotenv.config();
const app = express();

// 1. Dynamic CORS whitelist for Localhost + Production Frontend
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  process.env.CLIENT_URL // Automatically allows your live Vercel frontend URL once deployed
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like Postman or mobile apps) or if in whitelist
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

// 4. Connect to MongoDB and start the server safely
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('🚀 Connected smoothly to MongoDB Atlas Cluster');
    app.listen(PORT, () => console.log(`Server executing safely on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ Database pipeline connection failure:', err.message);
  });