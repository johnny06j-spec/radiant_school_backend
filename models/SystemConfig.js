// models/SystemConfig.js
import mongoose from 'mongoose';

const SystemConfigSchema = new mongoose.Schema({
  currentSession: {
    type: String,
    required: true,
    default: "2028/2029"
  },
  currentTerm: {
    type: String,
    required: true,
    enum: ['First Term', 'Second Term', 'Third Term'],
    default: "First Term"
  }
}, { timestamps: true });

export default mongoose.model('SystemConfig', SystemConfigSchema);