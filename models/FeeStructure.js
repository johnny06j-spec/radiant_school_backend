// models/FeeStructure.js
import mongoose from 'mongoose';

/**
 * Helper to normalize class names on save to prevent Roman numeral / formatting mismatches
 */
const normalizeClassName = (className) => {
  if (!className) return "";
  let normalized = className.trim().toUpperCase();
  return normalized
    .replace(/\bKG\s*I\b/g, 'KG 1')
    .replace(/\bKG\s*II\b/g, 'KG 2')
    .replace(/\bKG\s*III\b/g, 'KG 3')
    .replace(/\bPRIMARY\s*/g, 'BASIC ')
    .replace(/\bGRADE\s*/g, 'BASIC ')
    .replace(/\bJSS\s*I\b/g, 'JSS 1')
    .replace(/\bJSS\s*II\b/g, 'JSS 2')
    .replace(/\bJSS\s*III\b/g, 'JSS 3')
    .replace(/\bSSS\s*I\b/g, 'SSS 1')
    .replace(/\bSSS\s*II\b/g, 'SSS 2')
    .replace(/\bSSS\s*III\b/g, 'SSS 3');
};

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
  
  // 🔒 REMOVED DEFAULT: Strictly require campus to prevent unassigned structures from defaulting to Emerald Campus
  campus: { 
    type: String, 
    required: [true, 'Campus identifier is strictly required for fee structures'], 
    trim: true,
    enum: ['Emerald Campus', 'Great Campus']
  },
  
  items: [FeeItemSchema],
  totalAmount: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ['Active', 'Inactive', 'active', 'inactive'], 
    default: 'Active' 
  }
}, { timestamps: true });

// 🟢 Pre-save hook: Normalize class name and automatically compute total amount
FeeStructureSchema.pre('save', function (next) {
  if (this.className) {
    this.className = normalizeClassName(this.className);
  }
  if (this.campus) {
    this.campus = String(this.campus).trim();
  }
  if (Array.isArray(this.items)) {
    this.totalAmount = this.items.reduce((sum, item) => {
      return item.checked !== false ? sum + (Number(item.amount) || 0) : sum;
    }, 0);
  }
  if (typeof next === 'function') next();
});

// 🔒 Force index rebuild on startup
FeeStructureSchema.set('autoIndex', true);

// 🔒 4-Field Compound Unique Index (Ensures distinct fee structure per campus + class + term + session)
FeeStructureSchema.index({ campus: 1, className: 1, term: 1, session: 1 }, { unique: true });

export default mongoose.model('FeeStructure', FeeStructureSchema);