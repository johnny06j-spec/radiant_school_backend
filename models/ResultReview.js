// models/ResultReview.js
import mongoose from 'mongoose';

const ResultReviewSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  name: { type: String, default: '' },
  admissionNo: { type: String, default: '' },
  className: { type: String, required: true },
  schoolSection: { type: String, enum: ['PRIMARY', 'SECONDARY'], default: 'PRIMARY' },
  term: { type: String, required: true },
  session: { type: String, required: true },

  // Scores, Cumulative Math & Calculated Broadsheet State
  overallAverage: { type: Number, default: 0 },
  overallGrade: { type: String, default: 'F' },
  subjects: { type: Array, default: [] },

  // Character Development (Affective Domain)
  characterDevelopment: {
    attendance: { type: String, default: 'A' },
    attentiveness: { type: String, default: 'A' },
    neatness: { type: String, default: 'A' },
    selfControl: { type: String, default: 'A' },
    punctuality: { type: String, default: 'A' },
    relationshipWithOthers: { type: String, default: 'A' }
  },

  // Practical Skills (Psychomotor Domain)
  practicalSkills: {
    handwriting: { type: String, default: 'A' },
    music: { type: String, default: 'A' },
    drama: { type: String, default: 'A' },
    games: { type: String, default: 'A' },
    crafts: { type: String, default: 'A' },
    clubs: { type: String, default: 'A' },
    reading: { type: String, default: 'A' }
  },

  // Remarks & Sign-offs
  teacherRemark: { type: String, default: '' },
  teacherSubmittedAt: { type: Date },

  principalRemark: { type: String, default: '' },
  principalApprovedAt: { type: Date },

  // Promotion Status (Third Term)
  promotionDecision: { 
    type: String, 
    enum: ['PROMOTED', 'REPEAT', 'WITHDRAWN', 'PENDING', 'N/A'], 
    default: 'N/A' 
  },
  promotedToClass: { type: String, default: '' },

  // Workflow Approval State Machine
  status: { 
    type: String, 
    enum: ['Draft', 'Submitted', 'Pending Review', 'Approved', 'Returned for Revision', 'Released'],
    default: 'Submitted' 
  },
  isApprovedByExecutive: { type: Boolean, default: false },
  isApprovedByPrincipal: { type: Boolean, default: false },
  reviewedByRole: { type: String, enum: ['principal', 'headmaster', 'admin', 'executive', 'none'], default: 'none' },

  // Return & Revision Auditing
  rejectionReason: { type: String, default: '' },
  returnReason: { type: String, default: '' },
  returnedBy: { type: String, default: '' },
  returnedAt: { type: Date },
  previousStatus: { type: String, default: '' },

  releasedAt: { type: Date }
}, { timestamps: true, strict: false });

ResultReviewSchema.index({ studentId: 1, term: 1, session: 1 }, { unique: true });

const ResultReview = mongoose.models.ResultReview || mongoose.model('ResultReview', ResultReviewSchema);
export default ResultReview;