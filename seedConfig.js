// seedConfig.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SystemConfig from './models/SystemConfig.js';

dotenv.config();

const seedConfig = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
    console.log("💾 Connected to MongoDB...");

    // Check if configuration already exists
    const existingConfig = await SystemConfig.findOne({});
    if (existingConfig) {
      console.log("⚙️ System Configuration already exists:", existingConfig);
    } else {
      await SystemConfig.create({
        currentSession: "2026/2027",
        currentTerm: "First Term",
        unlockedSessions: ["2026/2027"]
      });
      console.log("✅ Baseline System Configuration successfully created!");
    }

    mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
};

seedConfig();