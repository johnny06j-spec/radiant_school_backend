import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  }, // e.g., "English Language", "Chemistry"
  code: { 
    type: String, 
    trim: true 
  }, // e.g., "ENG", "CHM"
  section: { 
    type: String, 
    enum: ['KG_Nursery', 'Primary', 'Junior_Secondary', 'Senior_Secondary'], 
    required: true 
  },
  track: { 
    type: String, 
    enum: ['General', 'Science', 'Arts', 'Commercial'], 
    default: 'General' 
  },
  hasProject: { 
    type: Boolean, 
    default: true 
  }, // 🎯 Toggle false for External Teachers (Exam becomes /70 instead of /55)
  maxTest1: { type: Number, default: 15 },
  maxTest2: { type: Number, default: 15 },
  maxProject: { type: Number, default: 15 },
  maxExam: { type: Number, default: 55 }
}, { timestamps: true });

// Pre-save hook to adjust maxExam dynamically if hasProject is toggled
subjectSchema.pre('save', function(next) {
  if (this.section === 'KG_Nursery' || this.section === 'Primary') {
    this.hasProject = false;
    this.maxTest1 = 20;
    this.maxTest2 = 20;
    this.maxProject = 0;
    this.maxExam = 60;
  } else if (!this.hasProject) {
    this.maxProject = 0;
    this.maxExam = 70;
  } else {
    this.maxTest1 = 15;
    this.maxTest2 = 15;
    this.maxProject = 15;
    this.maxExam = 55;
  }
  next();
});

export default mongoose.model('Subject', subjectSchema);