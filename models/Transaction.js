// models/Transaction.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  email: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true // Store in Naira
  },
  reference: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Success', 'Failed'],
    default: 'Pending'
  },
  metadata: {
    term: { type: String, required: true },
    session: { type: String, required: true },
    paymentType: { type: String, required: true }
  }
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);