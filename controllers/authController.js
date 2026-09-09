// controllers/authController.js
import User from '../models/User.js';
import Student from '../models/Student.js'; 
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

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
 * @desc    Authenticate administrative, staff, and student personnel
 * @access  Public
 */
export const loginUser = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

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

    const token = jwt.sign(
      { 
        id: user._id, 
        role: user.role,
        campus: user.campus || 'Emerald Campus',
        isClassTeacher: user.isClassTeacher || false,
        classTeacherOf: user.classTeacherOf || ''
      },
      process.env.JWT_SECRET || 'fallbackSecretKey',
      { expiresIn: '1d' }
    );

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.name || 'User'}`,
      token,
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
      message: "Server error during authentication.",
      error: error.message 
    });
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

    const targetClass = (currentClass || assignedClass || '').trim();
    const targetSession = (admittedSession || intakeSession || admissionSession || '2026/2027').trim();
    const targetTerm = (admittedTerm || intakeTerm || admissionTerm || 'First Term').trim();
    const targetCampus = (campus && ['Emerald Campus', 'Great Campus'].includes(campus.trim())) ? campus.trim() : 'Emerald Campus';

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

    // 3. Create Student record
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
      message: error.message || "Internal server error during student entry creation."
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

    // 🏫 Campus Filter ('Emerald Campus' or 'Great Campus')
    if (req.query.campus && req.query.campus !== 'All Campuses') {
      queryFilters.campus = req.query.campus;
    }

    if (req.query.search) {
      queryFilters.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { admissionNo: { $regex: req.query.search, $options: "i" } }
      ];
    }
    
    if (req.query.assignedClass || req.query.currentClass) {
      const cls = String(req.query.assignedClass || req.query.currentClass).trim();
      const classRegex = new RegExp(`^${cls.replace(/\s+/g, '\\s*')}$`, 'i');
      queryFilters.$or = [
        { currentClass: classRegex },
        { assignedClass: classRegex },
        { className: classRegex }
      ];
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
      message: "Internal server error streaming active student profiles.",
      error: error.message
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
        databaseLink: "127.0.0.1" 
      }
    });
  } catch (error) {
    console.error("💥 Dashboard statistics pipeline exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error gathering dashboard overview metrics.", 
      error: error.message 
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