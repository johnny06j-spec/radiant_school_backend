// seedAdmin.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

dotenv.config();

const seedAdminAccount = async () => {
  try {
    // 1. Establish temporary connection pipeline to Atlas
    await mongoose.connect(process.env.MONGO_URI);
    console.log('连接 🚀 Temporary pipeline connected to Atlas for account generation...');

    // 2. Clear out any old admin users to prevent duplicates
    await User.deleteMany({ role: 'admin' });

    // 3. Securely hash our development password
    const securePassword = await bcrypt.hash('admin12345', 10);

    // 4. Draft the master admin document records
    const masterAdmin = new User({
      name: "PRINCIPAL MASTER ADMIN",
      email: "admin@radiantschool.com",
      username: "RAD/ADMIN/01",
      password: securePassword,
      role: "admin"
    });

    // 5. Commit record to cloud database cluster
    await masterAdmin.save();
    
    console.log('\n======================================================');
    console.log('🎉 MASTER ADMIN ACCOUNT SEEDED SUCCESSFULLY!');
    console.log('======================================================');
    console.log('Use these credentials to cross the Access Gate:');
    console.log('👉 Username/Email: admin@radiantschool.com');
    console.log('👉 Security Key:    admin12345');
    console.log('======================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding pipeline failure:', error.message);
    process.exit(1);
  }
};

seedAdminAccount();