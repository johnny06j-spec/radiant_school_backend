// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    uppercase: true,
    trim: true 
  },
  surname: { type: String, trim: true },
  firstName: { type: String, trim: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true 
  }, // e.g., "john.doe" for teachers, or "RC/26/4829" for students
  password: { 
    type: String, 
    required: true 
  },
  role: { 
    type: String, 
    enum: ['admin', 'teacher', 'principal', 'student'], 
    default: 'student' 
  },
  phone: {
    type: String,
    trim: true
  },
  schoolSection: {
    type: String,
    enum: ['PRIMARY', 'SECONDARY'],
    default: 'PRIMARY'
  },
  department: {
    type: String,
    default: 'General'
  },
  assignedClass: {
    type: String, // Used for Primary Tutors (e.g., "KG 1", "Basic 3")
    default: ''
  },
  assignedClasses: [{ type: String }],
  assignedSubjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],

  // 🎯 CLASS TEACHER ASSIGNMENT & PERMISSION FIELDS
  isClassTeacher: { 
    type: Boolean, 
    default: false 
  },
  classTeacherOf: { 
    type: String, 
    default: '' // e.g., "JSS 1", "Basic 4"
  },
  
  // 🎯 Flexible Subject Allocations for Secondary & Primary Tutors
  subjectAllocations: [
    {
      className: { type: String },
      subjectName: { type: String }
    }
  ],
  status: {
    type: String,
    default: 'Active'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

export default mongoose.model('User', userSchema);