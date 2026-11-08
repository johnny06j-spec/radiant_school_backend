// models/Student.js
import mongoose from 'mongoose';

/**
 * Helper to normalize student class names on save
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

const studentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, uppercase: true },
  surname: { type: String, trim: true },
  firstName: { type: String, trim: true },
  otherName: { type: String, trim: true },
  admissionNo: { type: String, required: true, unique: true },
  currentClass: { type: String, required: true, trim: true },

  // 🏫 MULTI-CAMPUS IDENTIFIER
  campus: {
    type: String,
    required: [true, 'School campus selection is required'],
    enum: ['Emerald Campus', 'Great Campus'],
    trim: true,
    default: 'Emerald Campus'
  },

  // 🟢 MULTI-CHILD SIBLING LINKING ARRAY
  linkedSiblings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],

  // 🟢 EXACT INTAKE TIMELINE TRACKING
  intakeSession: { 
    type: String, 
    required: [true, 'Intake session is required'], 
    trim: true,
    default: "2026/2027" 
  },
  intakeTerm: { 
    type: String, 
    required: [true, 'Intake term is required'], 
    trim: true, 
    enum: ['First Term', 'Second Term', 'Third Term'],
    default: "First Term" 
  },

  // 🔄 BACKWARDS COMPATIBILITY ALIASES
  admittedSession: { type: String, trim: true },
  admissionSession: { type: String, trim: true },
  admittedTerm: { type: String, trim: true },
  admissionTerm: { type: String, trim: true },

  // DEMOGRAPHICS & PERSONAL DATA
  religion: { type: String, required: [true, 'Religion is required'], trim: true },
  gender: {
    type: String,
    required: false,
    enum: ['Male', 'Female', 'Not Specified'],
    default: 'Not Specified'
  },
  dob: { type: mongoose.Schema.Types.Mixed, default: "Not Specified" },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  stateOfOrigin: { type: String },
  lga: { type: String },
  homeTown: { type: String },
  passportPhoto: { type: String, default: "" },

  // 🏠 RESIDENTIAL & GUARDIAN ADDRESS FIELDS
  address: { type: String, trim: true, default: "" },
  residentialAddress: { type: String, trim: true, default: "" },
  
  // PARENT / GUARDIAN DATA FIELDS
  fatherName: { type: String, default: "" },
  fatherPhone: { type: String, default: "" },
  motherName: { type: String, default: "" },
  motherPhone: { type: String, default: "" },
  guardianAddress: { type: String, trim: true, default: "" },

  // FINANCIAL OVERVIEW FIELDS
  previousOutstanding: { type: Number, default: 0 },
  totalOwed: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  status: { type: String, default: "Active" }
}, { timestamps: true });

// 🟢 Pre-save middleware cleanly synchronizes intake aliases, campus string, and normalized class names
studentSchema.pre('save', function (next) {
  if (this.currentClass) {
    this.currentClass = normalizeClassName(this.currentClass);
  }

  if (this.campus) {
    this.campus = String(this.campus).trim();
  }

  if (this.intakeSession) {
    if (!this.admittedSession) this.admittedSession = this.intakeSession;
    if (!this.admissionSession) this.admissionSession = this.intakeSession;
  }
  if (this.intakeTerm) {
    if (!this.admittedTerm) this.admittedTerm = this.intakeTerm;
    if (!this.admissionTerm) this.admissionTerm = this.intakeTerm;
  }

  // 🏠 Keep address aliases in sync
  const primaryAddress = this.address || this.residentialAddress || "";
  if (primaryAddress) {
    this.address = primaryAddress;
    this.residentialAddress = primaryAddress;
    if (!this.guardianAddress) {
      this.guardianAddress = primaryAddress;
    }
  }

  if (typeof next === 'function') next();
});

export default mongoose.model('Student', studentSchema);