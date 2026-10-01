// models/Student.js
import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, uppercase: true },
  surname: { type: String, trim: true },
  firstName: { type: String, trim: true },
  otherName: { type: String, trim: true },
  admissionNo: { type: String, required: true, unique: true },
  currentClass: { type: String, required: true },

  // 🏫 MULTI-CAMPUS IDENTIFIER
  campus: {
    type: String,
    required: [true, 'School campus selection is required'],
    enum: ['Emerald Campus', 'Great Campus'],
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

// 🟢 Pre-save middleware cleanly synchronizes intake aliases and address fields
studentSchema.pre('save', function (next) {
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