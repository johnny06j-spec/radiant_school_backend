// models/Attendance.js
import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
  className: { 
    type: String, 
    required: true 
  },
  date: { 
    type: String, 
    required: true // Format: "YYYY-MM-DD"
  },
  recordedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  records: [
    {
      student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
      name: { type: String, required: true },
      admissionNo: { type: String, required: true },
      status: { 
        type: String, 
        enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'], 
        default: 'PRESENT' 
      },
      remark: { type: String, default: '' }
    }
  ]
}, { timestamps: true });

// Ensure one register per class per date
attendanceSchema.index({ className: 1, date: 1 }, { unique: true });

export default mongoose.model('Attendance', attendanceSchema);