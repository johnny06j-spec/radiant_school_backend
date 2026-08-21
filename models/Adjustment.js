// models/Adjustment.js
import mongoose from 'mongoose';

const adjustmentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  type: {
    type: String,
    enum: ['Discount', 'Waiver', 'Fee Increase'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative']
  },
  term: {
    type: String,
    required: true // e.g., 'First Term'
  },
  session: {
    type: String,
    required: true // e.g., '2026/2027'
  },
  reason: {
    type: String,
    required: true // e.g., 'Scholarship discount', 'Late payment fine'
  },
  issuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

export default mongoose.model('Adjustment', adjustmentSchema);