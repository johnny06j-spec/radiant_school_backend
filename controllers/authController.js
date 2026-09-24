// controllers/authController.js
import User from '../models/User.js';
import Student from '../models/Student.js'; 
import RefreshToken from '../models/RefreshToken.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as otplib from 'otplib';
import qrcode from 'qrcode';
import { generateAccessToken, generateAndStoreRefreshToken } from '../utils/tokenService.js';
import { sendSecurityAlertEmail } from '../utils/emailService.js';

const { authenticator } = otplib;

// Cookie Configuration for Cross-Origin Production Setup (Vercel Frontend + Render Backend)
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true, // Always true in HTTPS / Production
  sameSite: 'None', // Required for cross-domain Vercel <-> Render cookie sharing
  path: '/'
};

/**
 * Helper to extract the 2-digit starting year prefix from a session string (e.g., "2027/2028" -> "27")
 */
const getSessionYearPrefix = (sessionStr) => {
  if (!sessionStr) return "26";
  const match = String(sessionStr).match(/^(\d{4})/);
  return match ? match[1].slice(-2) : "26";
};

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate administrative, staff, and student personnel using secure httpOnly cookies
 * @access  Public
 */
export const loginUser = async (req, res) => {
  try {
    const { usernameOrEmail, password, twoFactorToken } = req.body;

    if (!usernameOrEmail || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide both username/email and password."
      });
    }

    const cleanIdentifier = String(usernameOrEmail).trim();

    const user = await User.findOne({
      $or: [
        { email: cleanIdentifier.toLowerCase() },
        { username: cleanIdentifier }
      ]
    }).select('+password');

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid credentials recorded." 
      });
    }

    if (user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Account is deactivated. Contact system administrator."
      });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch (err) {
      isMatch = (password === user.password);
    }

    if (!isMatch && password === user.password) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid credentials recorded." 
      });
    }

    // 🔐 CHECK IF 2FA IS ENABLED FOR THIS ACCOUNT (ADMIN PROTECTION)
    if (user.isTwoFactorEnabled) {
      // If no 2FA token provided yet, prompt the frontend to request 2FA code
      if (!twoFactorToken) {
        return res.status(200).json({
          success: true,
          requireTwoFactor: true,
          message: "Two-factor authentication code required.",
          userId: user._id
        });
      }

      // Verify the provided 2FA token against stored secret
      const userWithSecret = await User.findById(user._id).select('+twoFactorSecret');
      const isValid2FA = authenticator.check(twoFactorToken, userWithSecret.twoFactorSecret);

      if (!isValid2FA) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired 2FA verification code."
        });
      }
    }

    // Generate short-lived access token and 7-day refresh token
    const accessToken = generateAccessToken(user._id);
    const refreshToken = await generateAndStoreRefreshToken(user._id);

    // Attach httpOnly cookies to response
    res.cookie('accessToken', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 }); // 15 mins
    res.cookie('refreshToken', refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 }); // 7 days

    // Send Login Security Alert Email for Admin Logins
    if (user.role === 'admin') {
      sendSecurityAlertEmail(
        user.email,
        '🛡️ Security Alert: New Admin Portal Login',
        `Hello ${user.name},\n\nA successful login to the Radiant Admin Command Portal was recorded on ${new Date().toLocaleString()}.\n\nIf this was not you, change your password immediately.`
      );
    }

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.name || 'User'}`,
      user: {
        id: user._id,
        name: user.name || '',
        surname: user.surname || '',
        firstName: user.firstName || '',
        email: user.email || '',
        username: user.username || '',
        role: user.role,
        campus: user.campus || 'Emerald Campus',
        schoolSection: user.schoolSection,
        assignedClass: user.assignedClass,
        isClassTeacher: Boolean(user.isClassTeacher),
        classTeacherOf: user.classTeacherOf || '',
        subjectAllocations: user.subjectAllocations || [],
        assignedClasses: user.assignedClasses || [],
        assignedSubjects: user.assignedSubjects || []
      }
    });

  } catch (error) {
    console.error("💥 Auth Pipeline Exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error during authentication."
    });
  }
};

/**
 * @route   POST /api/auth/refresh
 * @desc    Rotate and re-issue short-lived access tokens using hashed refresh token check
 * @access  Public (Cookie Based)
 */
export const refreshTokenSession = async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;
    if (!rawRefreshToken) {
      return res.status(401).json({ success: false, message: "No refresh token provided." });
    }

    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const storedToken = await RefreshToken.findOne({ tokenHash, revoked: false });

    if (!storedToken || new Date() > storedToken.expiresAt) {
      return res.status(401).json({ success: false, message: "Refresh token expired or revoked." });
    }

    const user = await User.findById(storedToken.userId);
    if (!user || user.isActive === false) {
      return res.status(401).json({ success: false, message: "User account inactive or missing." });
    }

    // Revoke used token (Token Rotation)
    storedToken.revoked = true;
    await storedToken.save();

    // Issue new pair
    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = await generateAndStoreRefreshToken(user._id);

    res.cookie('accessToken', newAccessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', newRefreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });

    return res.status(200).json({ success: true, message: "Session refreshed successfully." });
  } catch (error) {
    console.error("💥 Refresh Token Pipeline Exception:", error);
    return res.status(500).json({ success: false, message: "Error refreshing session token." });
  }
};

/**
 * @route   POST /api/auth/logout
 * @desc    Revoke stored refresh token and wipe httpOnly cookies
 * @access  Public
 */
export const logoutUser = async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;
    if (rawRefreshToken) {
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
      await RefreshToken.updateOne({ tokenHash }, { revoked: true });
    }

    res.clearCookie('accessToken', COOKIE_OPTIONS);
    res.clearCookie('refreshToken', COOKIE_OPTIONS);

    return res.status(200).json({ success: true, message: "Logged out cleanly." });
  } catch (error) {
    console.error("💥 Logout Pipeline Exception:", error);
    return res.status(500).json({ success: false, message: "Internal server error on logout." });
  }
};

/**
 * @route   POST /api/auth/register-student
 * @desc    Enroll a brand new student profile with selected campus assignment
 * @access  Private (Admin Control Panel)
 */
export const registerStudent = async (req, res) => {
  let createdBaseUser = null; 
  
  try {
    const { 
      surname, 
      firstName, 
      otherName, 
      assignedClass,
      currentClass, 
      campus,
      admittedSession,
      intakeSession,
      admissionSession,
      admittedTerm,
      intakeTerm,
      admissionTerm,
      gender, 
      email, 
      phone, 
      stateOfOrigin,
      lga,
      homeTown,
      dob,
      bloodGroup,
      genotype,
      religion,
      address,
      fatherName,
      fatherPhone,
      motherName,
      motherPhone,
      guardianAddress
    } = req.body;

    const safeFirstName = String(firstName || '').trim();
    const safeSurname = String(surname || '').trim();
    const safeOtherName = String(otherName || '').trim();

    let rawCampus = campus;
    if (Array.isArray(rawCampus)) {
      rawCampus = rawCampus[0];
    } else if (typeof rawCampus === 'string' && rawCampus.includes(',')) {
      rawCampus = rawCampus.split(',')[0];
    }
    const cleanCampus = (rawCampus && String(rawCampus).trim() !== '') ? String(rawCampus).trim() : 'Emerald Campus';

    const targetClass = String(currentClass || assignedClass || '').trim();
    const targetSession = String(admittedSession || intakeSession || admissionSession || '2026/2027').trim();
    const targetTerm = String(admittedTerm || intakeTerm || admissionTerm || 'First Term').trim();
    const targetCampus = cleanCampus;

    if (!safeSurname || !safeFirstName || !targetClass || !targetSession || !email) {
      return res.status(400).json({
        success: false,
        message: "Please fill out all required core fields."
      });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const existingEmail = await User.findOne({ email: cleanEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "A user record with this email address already exists."
      });
    }

    const sessionYearShort = getSessionYearPrefix(targetSession);
    
    let autoGeneratedRegNo;
    let isUsernameTaken = true;

    while (isUsernameTaken) {
      const randomNumericSuffix = Math.floor(1000 + crypto.randomInt(0, 9000));
      autoGeneratedRegNo = `RC/${sessionYearShort}/${randomNumericSuffix}`;
      
      const userCheck = await User.findOne({ username: autoGeneratedRegNo });
      if (!userCheck) {
        isUsernameTaken = false; 
      }
    }

    const normalizedName = safeFirstName.replace(/[^a-zA-Z]/g, '');
    const cleanFirstName = normalizedName ? (normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1).toLowerCase()) : 'Student';
    const randomToken = Math.floor(1000 + Math.random() * 9000);
    const temporaryPassword = `${cleanFirstName}#${randomToken}`;

    const fullName = `${safeFirstName} ${safeSurname} ${safeOtherName}`.replace(/\s+/g, ' ').trim();

    let passportPhotoUrl = "";
    if (req.file) {
      passportPhotoUrl = req.file.path || req.file.secure_url || req.file.url || "";
    }

    // 1. Create Base User
    createdBaseUser = await User.create({
      name: fullName,
      surname: safeSurname,
      firstName: safeFirstName,
      username: autoGeneratedRegNo,
      email: cleanEmail,
      password: temporaryPassword,
      role: 'student',
      campus: targetCampus
    });

    // 2. Parse Date of Birth safely
    let parsedDob = undefined;
    if (dob && typeof dob === 'string' && dob.trim() !== '' && dob !== 'Not Specified') {
      const d = new Date(dob);
      if (!isNaN(d.getTime())) {
        parsedDob = d;
      }
    }

    // 3. Create Student Record
    const newStudent = await Student.create({
      user: createdBaseUser._id, 
      name: fullName,
      surname: safeSurname,
      firstName: safeFirstName,
      otherName: safeOtherName,
      admissionNo: autoGeneratedRegNo,
      currentClass: targetClass, 
      assignedClass: targetClass,
      campus: targetCampus,
      admittedSession: targetSession,
      intakeSession: targetSession,
      admissionSession: targetSession,
      admittedTerm: targetTerm,
      intakeTerm: targetTerm,
      admissionTerm: targetTerm,
      gender: gender && String(gender).trim() !== "" ? String(gender).trim() : "Not Specified",
      email: cleanEmail,
      phone: phone && String(phone).trim() !== "" ? String(phone).trim() : undefined,
      stateOfOrigin: stateOfOrigin && String(stateOfOrigin).trim() !== "" ? String(stateOfOrigin).trim() : undefined,
      lga: lga && String(lga).trim() !== "" ? String(lga).trim() : undefined,
      homeTown: homeTown && String(homeTown).trim() !== "" ? String(homeTown).trim() : undefined,
      dob: parsedDob,
      bloodGroup: bloodGroup && String(bloodGroup).trim() !== "" ? String(bloodGroup).trim() : undefined,
      genotype: genotype && String(genotype).trim() !== "" ? String(genotype).trim() : undefined,
      religion: religion && String(religion).trim() !== "" ? String(religion).trim() : undefined,
      address: address && String(address).trim() !== "" ? String(address).trim() : undefined,
      password: temporaryPassword, 
      passportPhoto: passportPhotoUrl, 
      role: 'student',

      fatherName: fatherName ? String(fatherName).trim() : "",
      fatherPhone: fatherPhone ? String(fatherPhone).trim() : "",
      motherName: motherName ? String(motherName).trim() : "",
      motherPhone: motherPhone ? String(motherPhone).trim() : "",
      guardianAddress: guardianAddress ? String(guardianAddress).trim() : ""
    });

    return res.status(201).json({
      success: true,
      message: "Student profile registered successfully.",
      student: {
        id: newStudent._id,
        name: newStudent.name,
        admissionNo: newStudent.admissionNo,
        currentClass: newStudent.currentClass,
        campus: newStudent.campus,
        passportPhoto: newStudent.passportPhoto
      },
      credentials: {
        username: autoGeneratedRegNo,
        temporaryPassword: temporaryPassword
      }
    });

  } catch (error) {
    if (createdBaseUser) {
      await User.deleteOne({ _id: createdBaseUser._id }).catch((err) => 
        console.error("⚠️ Failed cleaning up orphan record:", err)
      );
    }

    console.error("💥 Student enrollment pipeline exception:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during student entry creation."
    });
  }
};

/**
 * @route   GET /api/auth/students
 * @desc    Fetch active enrolled student records with server-side pagination and campus filter
 * @access  Private
 */
export const getAllStudents = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skipIndex = (page - 1) * limit;

    const queryFilters = {};

    if (req.query.campus && req.query.campus !== 'All Campuses') {
      queryFilters.campus = req.query.campus;
    }

    if (req.query.search && req.query.search.trim() !== '') {
      queryFilters.$or = [
        { name: { $regex: req.query.search.trim(),$options: "i" } },
        { surname: { $regex: req.query.search.trim(),$options: "i" } },
        { firstName: { $regex: req.query.search.trim(),$options: "i" } },
        { admissionNo: { $regex: req.query.search.trim(),$options: "i" } }
      ];
    }
    
    if (req.query.assignedClass || req.query.currentClass) {
      const cls = String(req.query.assignedClass || req.query.currentClass).trim();
      const classRegex = new RegExp(`^${cls.replace(/\s+/g, '\\s*')}$`, 'i');
      
      const classConditions = [
        { currentClass: classRegex },
        { assignedClass: classRegex },
        { className: classRegex }
      ];

      if (queryFilters.$or) {
        queryFilters.$and = [
          { $or: queryFilters.$or },
          { $or: classConditions }
        ];
        delete queryFilters.$or;
      } else {
        queryFilters.$or = classConditions;
      }
    }

    if (req.query.admittedSession) {
      queryFilters.admittedSession = req.query.admittedSession;
    }

    const [totalStudents, students] = await Promise.all([
      Student.countDocuments(queryFilters),
      Student.find(queryFilters)
        .sort({ surname: 1, firstName: 1 })
        .skip(skipIndex)
        .limit(limit)
        .lean()
    ]);

    const totalPages = Math.ceil(totalStudents / limit);

    return res.status(200).json({
      success: true,
      students,
      pagination: {
        totalRecords: totalStudents,
        currentPage: page,
        totalPages: totalPages,
        limit: limit,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages
      }
    });

  } catch (error) {
    console.error("💥 Student collection stream pipeline exception:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error streaming active student profiles."
    });
  }
};

/**
 * @route   GET /api/auth/dashboard-stats
 * @desc    Fetch live counts for the admin dashboard overview metrics filtered optional by campus
 */
export const getDashboardStats = async (req, res) => {
  try {
    const { campus } = req.query;
    const filter = (campus && campus !== 'All Campuses') ? { campus } : {};

    const totalStudents = await Student.countDocuments(filter);
    
    const activeTeachers = await User.countDocuments({ 
      ...filter,
      role: { $in: ['teacher', 'principal', 'TEACHER', 'PRINCIPAL'] } 
    });

    return res.status(200).json({
      success: true,
      stats: {
        totalStudents,
        activeTeachers,
        isDbConnected: true
      }
    });
  } catch (error) {
    console.error("💥 Dashboard statistics pipeline exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error gathering dashboard overview metrics."
    });
  }
};

/**
 * @route   PUT /api/auth/update-password
 */
export const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id; 

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: "Please provide both your current and new password." 
      });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: "User profile not found." });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(currentPassword, user.password);
    } catch (err) {
      isMatch = (currentPassword === user.password);
    }

    if (!isMatch && currentPassword === user.password) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Your current password context is incorrect." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    if (user.role === 'student') {
      await Student.findOneAndUpdate({ user: user._id }, { password: hashedPassword });
    }

    return res.status(200).json({
      success: true,
      message: "Password upgraded cleanly into secure systems architecture."
    });

  } catch (error) {
    console.error("💥 Password migration pipeline error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error upgrading credential properties." 
    });
  }
};

/**
 * @route   POST /api/auth/2fa/setup
 * @desc    Generate TOTP secret and QR code for Admin authenticator app setup
 * @access  Private (Admin Only)
 */
export const setupTwoFactor = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only administrative accounts can configure 2FA.' });
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'Radiant Intellectuals College', secret);
    const qrCodeImageUrl = await qrcode.toDataURL(otpauthUrl);

    // Save temporary unverified secret
    user.twoFactorSecret = secret;
    await user.save();

    return res.status(200).json({
      success: true,
      qrCodeUrl: qrCodeImageUrl,
      secretKey: secret
    });
  } catch (error) {
    console.error('💥 2FA Setup Pipeline Exception:', error);
    return res.status(500).json({ success: false, message: 'Internal server error setting up multi-factor auth.' });
  }
};

/**
 * @route   POST /api/auth/2fa/verify
 * @desc    Verify TOTP token code, activate 2FA, and send emergency alert notification
 * @access  Private (Admin Only)
 */
export const verifyTwoFactor = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Verification code required.' });
    }

    const user = await User.findById(req.user.id).select('+twoFactorSecret');
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: 'No 2FA setup requested for this account.' });
    }

    const isValid = authenticator.check(token, user.twoFactorSecret);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid authentication code. Ensure time sync on your device.' });
    }

    user.isTwoFactorEnabled = true;
    await user.save();

    // Send security notification email to Outlook inbox
    await sendSecurityAlertEmail(
      user.email,
      '🛡️ Security Alert: Multi-Factor Authentication Activated',
      `Hello ${user.name},\n\nTwo-Factor Authentication (2FA) has been successfully activated on your Radiant Admin account.\n\nIf you did not initiate this change, contact system engineering immediately.`
    );

    return res.status(200).json({
      success: true,
      message: 'Two-Factor Authentication enabled successfully.'
    });
  } catch (error) {
    console.error('💥 2FA Verification Exception:', error);
    return res.status(500).json({ success: false, message: 'Internal server error verifying multi-factor auth.' });
  }
};