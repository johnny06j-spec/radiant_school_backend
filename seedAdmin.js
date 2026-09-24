// seedAdmin.js
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import User from './models/User.js';

dotenv.config();

const seedAdminAccount = async () => {
  try {
    // 1. Establish temporary connection pipeline to Atlas
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🚀 Temporary pipeline connected to Atlas for account generation...');

    // 2. Clear out any old admin users to prevent duplicates
    await User.deleteMany({ role: 'admin' });

    // 3. Set your target credentials
    const adminEmail = "radiantintellectualscollege@outlook.com"; 
    const rawPassword = "RadiantM2003"; // 👈 Set your strong admin password here!

    // 4. Securely hash the password
    const securePassword = await bcrypt.hash(rawPassword, 10);

    // 5. Draft the master admin document records
    const masterAdmin = new User({
      name: "PRINCIPAL MASTER ADMIN",
      email: adminEmail,
      username: "RAD/ADMIN/01",
      password: securePassword,
      role: "admin",
      isActive: true
    });

    // 6. Commit record to cloud database cluster
    await masterAdmin.save();
    
    console.log('\n======================================================');
    console.log('🎉 MASTER ADMIN ACCOUNT SEEDED SUCCESSFULLY!');
    console.log('======================================================');
    console.log(`👉 Username/Email: ${adminEmail}`);
    console.log(`👉 Security Key:    [UPDATED]`);
    console.log('======================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding pipeline failure:', error.message);
    process.exit(1);
  }
};

seedAdminAccount();