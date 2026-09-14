// models/Attendance.js
import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  className: { type: String, required: true },
  campus: { type: String, required: true, default: 'Emerald Campus' },
  term: { type: String, required: true },
  session: { type: String, required: true },
  date: { type: Date, required: true },
  sessionPeriod: { type: String, enum: ['Morning', 'Afternoon'], default: 'Morning' },
  status: { type: String, enum: ['Present', 'Late', 'Absent', 'Excused'], default: 'Present' },
  remark: { type: String, default: '' }
}, { timestamps: true });

// 🔑 Unique compound index: prevents duplicate entries per student, date, and session period
attendanceSchema.index({ studentId: 1, date: 1, sessionPeriod: 1 }, { unique: true });

export default mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);