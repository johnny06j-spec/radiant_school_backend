// purge.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ResultReview from './models/ResultReview.js';

dotenv.config();

const purgeOrphanedResults = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log("🔌 Connected to database...");

    const deleted = await ResultReview.deleteMany({
      $or: [
        { name: 'Unnamed Student' },
        { admissionNo: 'N/A' },
        { name: { $exists: false } }
      ]
    });

    console.log(`✅ Cleaned up ${deleted.deletedCount} duplicate/unnamed records.`);
  } catch (err) {
    console.error("💥 Cleanup error:", err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

purgeOrphanedResults();