import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import RefreshToken from '../models/RefreshToken.js';

export const generateAccessToken = (userId) => {
  // Contains ONLY user ID, 15-minute expiration
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m'
  });
};

export const generateAndStoreRefreshToken = async (userId) => {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 Days

  await RefreshToken.create({
    userId,
    tokenHash,
    expiresAt
  });

  return rawToken;
};