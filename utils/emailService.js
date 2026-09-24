// utils/emailService.js
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    ciphers: 'SSLv3'
  }
});

/**
 * 📧 Send Security Alert Email on Admin Login / Password Change
 */
export const sendSecurityAlertEmail = async (toEmail, subject, textContent) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("⚠️ Email credentials missing in environment. Skipping security email alert.");
      return;
    }

    await transporter.sendMail({
      from: `"Radiant Security Guard" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: subject,
      text: textContent
    });

    console.log(`📧 Security notification email sent successfully to ${toEmail}`);
  } catch (err) {
    console.error("💥 Failed to send security email:", err.message);
  }
};