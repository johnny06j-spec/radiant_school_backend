// models/FeeStructure.js
import mongoose from 'mongoose';

const FeeItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // e.g., "Tuition Fee", "ICT Fee"
  appliesTo: { 
    type: String, 
    enum: ['All Students', 'New Students', 'Returning Students'], 
    default: 'All Students' 
  },
  amount: { type: Number, required: true, min: 0 },
  checked: { type: Boolean, default: true } // Active flag for individual fee items
});

const FeeStructureSchema = new mongoose.Schema({
  className: { type: String, required: true, trim: true }, // e.g., "JSS 1"
  term: { 
    type: String, 
    required: true, 
    trim: true,
    enum: ['First Term', 'Second Term', 'Third Term'] 
  }, // e.g., "First Term"
  session: { type: String, required: true, trim: true }, // e.g., "2026/2027"
  campus: { type: String, required: true, trim: true, default: 'Emerald Campus' }, // 👈 Multi-campus support
  items: [FeeItemSchema], // Array of itemized breakdowns
  totalAmount: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ['Active', 'Inactive', 'active', 'inactive'], 
    default: 'Active' 
  }
}, { timestamps: true });

// 🔒 Ensures unique fee structures per Class, Term, Session AND Campus
FeeStructureSchema.index({ className: 1, term: 1, session: 1, campus: 1 }, { unique: true });

export default mongoose.model('FeeStructure', FeeStructureSchema);