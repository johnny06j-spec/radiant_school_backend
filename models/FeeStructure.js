// models/FeeStructure.js
import mongoose from 'mongoose';

const FeeItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  appliesTo: { 
    type: String, 
    enum: ['All Students', 'New Students', 'Returning Students'], 
    default: 'All Students' 
  },
  amount: { type: Number, required: true, min: 0 },
  checked: { type: Boolean, default: true }
});

const FeeStructureSchema = new mongoose.Schema({
  className: { type: String, required: true, trim: true },
  term: { 
    type: String, 
    required: true, 
    trim: true,
    enum: ['First Term', 'Second Term', 'Third Term'] 
  },
  session: { type: String, required: true, trim: true },
  campus: { type: String, required: true, trim: true, default: 'Emerald Campus' },
  items: [FeeItemSchema],
  totalAmount: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ['Active', 'Inactive', 'active', 'inactive'], 
    default: 'Active' 
  }
}, { timestamps: true });

// 🔒 Force index rebuild on startup
FeeStructureSchema.set('autoIndex', true);

// 🔒 4-Field Compound Unique Index
FeeStructureSchema.index({ className: 1, term: 1, session: 1, campus: 1 }, { unique: true });

export default mongoose.model('FeeStructure', FeeStructureSchema);