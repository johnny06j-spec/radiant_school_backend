import mongoose from 'mongoose';

const StudentScoreSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  admissionNo: { type: String, default: '' },
  name: { type: String, required: true },
  ass1: { type: Number, default: 0 },
  ca1: { type: Number, default: 0 },
  ca2: { type: Number, default: 0 },
  project: { type: Number, default: 0 },
  exam: { type: Number, default: 0 },
  totalScore: { type: Number, default: 0 },
  grade: { type: String, default: 'E' }
});

const GradingGridSchema = new mongoose.Schema({
  className: { type: String, required: true },
  schoolSection: { type: String, default: 'SECONDARY' },
  subjectName: { type: String, required: true },
  term: { type: String, required: true },
  session: { type: String, required: true },
  status: { type: String, enum: ['Draft', 'Submitted'], default: 'Draft' },
  studentsScores: [StudentScoreSchema]
}, { timestamps: true });

// Create compound index for fast queries
GradingGridSchema.index({ className: 1, subjectName: 1, term: 1, session: 1 }, { unique: true });

const GradingGrid = mongoose.models.GradingGrid || mongoose.model('GradingGrid', GradingGridSchema);

export default GradingGrid;