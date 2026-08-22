// config/cloudinary.js
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'student_passports',
    // 🟢 Added webp, heic, heif, and jfif so mobile phone camera formats upload cleanly without failing
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'heic', 'heif', 'jfif'],
    transformation: [{ width: 500, height: 500, crop: 'limit', quality: 'auto' }],
  },
});

export const uploadPassport = multer({
  storage: storage,
  // 🟢 Raised upload limit to 10MB to accommodate high-res mobile snaps
  limits: { fileSize: 10 * 1024 * 1024 },
});