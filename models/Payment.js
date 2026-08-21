// models/Payment.js
import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  amountPaid: { type: Number, required: true, min: 1 },
  term: { type: String, required: true },
  session: { type: String, required: true },
  paymentMethod: { type: String, default: 'Online Channel' }, 
  reference: { type: String, required: true, unique: true },
  status: { type: String, enum: ['Successful', 'Pending', 'Failed'], default: 'Successful' }, // Added this field!
  paidAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Payment', PaymentSchema);