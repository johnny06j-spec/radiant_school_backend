// controllers/student/studentManageController.js
import mongoose from 'mongoose';
import Student from '../../models/Student.js';
import User from '../../models/User.js';
import { getSystemConfig } from './studentHelpers.js';

/**
 * @route   GET /api/students
 * @desc    Fetch list of all enrolled students with search & campus filters
 * @access  Private (Admin/Staff)
 */
export const getAllStudents = async (req, res) => {
  try {
    const { search, assignedClass, intakeSession, campus } = req.query;
    let query = {};

    if (campus && campus !== 'All Campuses') {
      query.campus = campus;
    }

    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { surname: searchRegex },
        { firstName: searchRegex },
        { otherName: searchRegex },
        { admissionNo: searchRegex }
      ];
    }

    if (assignedClass && assignedClass !== 'All Classes') {
      query.$or = [
        { currentClass: assignedClass },
        { assignedClass: assignedClass }
      ];
    }

    if (intakeSession && intakeSession !== 'All Sessions') {
      query.$or = [
        { admittedSession: intakeSession },
        { admissionSession: intakeSession },
        { academicSession: intakeSession }
      ];
    }

    const students = await Student.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: students.length,
      students
    });
  } catch (error) {
    console.error("💥 Student directory fetch exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Internal server error gathering student directory records.", 
      error: error.message 
    });
  }
};

/**
 * @route   GET /api/students/:id
 * @desc    Get a single student's complete profile parameters safely with ObjectId validation
 * @access  Private (Admin)
 */
export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid student record identifier format."
      });
    }

    const student = await Student.findById(id)
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto campus');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student operational record not found.' });
    }
    
    return res.status(200).json({
      success: true,
      student
    });
  } catch (error) {
    console.error("💥 Student profile parameter retrieval exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'Server error retrieving profile details.', 
      error: error.message 
    });
  }
};

/**
 * @route   PUT /api/students/:id
 * @desc    Update an existing student document safely with ObjectId validation and campus sanitization
 * @access  Private (Admin)
 */
export const updateStudent = async (req, res) => {
  try {
    const studentId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid student record identifier format."
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: "Student record targeted for update was not found." 
      });
    }

    const systemConfig = await getSystemConfig();
    const activeTerm = systemConfig?.currentTerm || "First Term";

    const body = req.body || {};

    const {
      firstName,
      surname,
      otherName,
      gender,
      email,
      campus,
      admissionTerm,
      admittedTerm,
      address,
      residentialAddress,
      guardianAddress,
      ...restBody
    } = body;

    let sanitizedCampus = campus;
    if (Array.isArray(sanitizedCampus)) {
      sanitizedCampus = sanitizedCampus[0];
    } else if (typeof sanitizedCampus === 'string' && sanitizedCampus.includes(',')) {
      sanitizedCampus = sanitizedCampus.split(',')[0];
    }

    if (firstName !== undefined && firstName !== null) student.firstName = String(firstName).trim();
    if (surname !== undefined && surname !== null) student.surname = String(surname).trim();
    if (otherName !== undefined && otherName !== null) student.otherName = String(otherName).trim();
    if (gender !== undefined && gender !== null) student.gender = String(gender).trim();
    if (email !== undefined && email !== null) student.email = String(email).toLowerCase().trim();
    
    const targetAddress = address || residentialAddress;
    if (targetAddress !== undefined && targetAddress !== null) {
      student.address = String(targetAddress).trim();
    }
    if (guardianAddress !== undefined && guardianAddress !== null) {
      student.guardianAddress = String(guardianAddress).trim();
    }

    if (sanitizedCampus) {
      student.campus = String(sanitizedCampus).trim();
    }

    const first = student.firstName || '';
    const sur = student.surname || '';
    const other = student.otherName || '';
    
    student.name = `${first} ${sur} ${other}`.replace(/\s+/g, ' ').trim();

    if (req.file && (req.file.path || req.file.secure_url)) {
      student.passportPhoto = req.file.path || req.file.secure_url;
    }

    if (!student.admissionTerm && !student.admittedTerm) {
      student.admissionTerm = activeTerm;
      student.admittedTerm = activeTerm;
    }

    delete restBody.campus;
    delete restBody.address;
    delete restBody.residentialAddress;

    Object.assign(student, restBody);

    const updatedStudent = await student.save();

    if (updatedStudent.user) {
      await User.findByIdAndUpdate(updatedStudent.user, {
        $set: {
          name: updatedStudent.name,
          email: updatedStudent.email ? updatedStudent.email.toLowerCase().trim() : undefined,
          campus: updatedStudent.campus
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: "Student profile updated successfully.",
      student: updatedStudent
    });

  } catch (error) {
    console.error("💥 Backend student record update mutation exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Internal server update error.", 
      error: error.message 
    });
  }
};

/**
 * @route   DELETE /api/students/:id
 * @desc    Permanently delete a student document cleanly with ObjectId validation
 * @access  Private (Admin)
 */
export const deleteStudent = async (req, res) => {
  try {
    const studentId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid student record identifier format."
      });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: "Target student record not found." });
    }

    if (student.user) {
      await User.findByIdAndDelete(student.user);
    }

    await Student.findByIdAndDelete(studentId);

    return res.status(200).json({
      success: true,
      message: "Student record cleanly purged."
    });
  } catch (error) {
    console.error("💥 Backend student deletion pipeline exception:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || "Internal server deletion error.", 
      error: error.message 
    });
  }
};