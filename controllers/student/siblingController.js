// controllers/student/siblingController.js
import Student from '../../models/Student.js';
import bcrypt from 'bcryptjs';

/**
 * @route   POST /api/students/link-sibling
 * @desc    Link a sibling student profile using Admission Number/Username & Password
 * @access  Private (Student)
 */
export const linkSibling = async (req, res) => {
  try {
    const currentStudentId = req.user.id;
    const { admissionNo, password } = req.body || {};

    if (!admissionNo || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Admission Number and Password are required." 
      });
    }

    const cleanedRef = admissionNo.trim();

    const currentStudent = await Student.findOne({
      $or: [{ _id: currentStudentId }, { user: currentStudentId }]
    });

    if (!currentStudent) {
      return res.status(404).json({
        success: false,
        message: "Your current student profile was not found."
      });
    }

    const targetSibling = await Student.findOne({
      $or: [
        { admissionNo: new RegExp(`^${cleanedRef}$`, 'i') },
        { admissionCode: new RegExp(`^${cleanedRef}$`, 'i') },
        { username: new RegExp(`^${cleanedRef}$`, 'i') }
      ]
    })
    .select('+password')
    .populate({
      path: 'user',
      select: '+password'
    });

    if (!targetSibling) {
      return res.status(404).json({ 
        success: false, 
        message: "No student account found matching this Admission Number / Username." 
      });
    }

    if (
      targetSibling._id.toString() === currentStudent._id.toString() ||
      (targetSibling.user && targetSibling.user._id.toString() === currentStudent.user?.toString())
    ) {
      return res.status(400).json({ 
        success: false, 
        message: "This account is already your current active profile." 
      });
    }

    let isMatch = false;
    if (targetSibling.password) {
      isMatch = await bcrypt.compare(password, targetSibling.password);
    }

    if (!isMatch && targetSibling.user && targetSibling.user.password) {
      isMatch = await bcrypt.compare(password, targetSibling.user.password);
    }

    if (!isMatch) {
      if (
        targetSibling.password === password ||
        (targetSibling.user && targetSibling.user.password === password)
      ) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication failed. Incorrect password for the target student." 
      });
    }

    await Student.findByIdAndUpdate(currentStudent._id, {
      $addToSet: { linkedSiblings: targetSibling._id }
    });

    await Student.findByIdAndUpdate(targetSibling._id, {
      $addToSet: { linkedSiblings: currentStudent._id }
    });

    const updatedStudent = await Student.findById(currentStudent._id)
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto campus');

    return res.status(200).json({
      success: true,
      message: `${targetSibling.firstName || targetSibling.name || 'Sibling'}'s account linked successfully!`,
      linkedSiblings: updatedStudent.linkedSiblings || []
    });

  } catch (error) {
    console.error("💥 Sibling account linking exception:", error);
    return res.status(500).json({
      success: false,
      message: "Server error occurred while linking sibling account.",
      error: error.message
    });
  }
};

/**
 * @route   POST /api/students/unlink-sibling
 * @desc    Unlink a sibling profile from the student's portal
 * @access  Private (Student)
 */
export const unlinkSibling = async (req, res) => {
  try {
    const { siblingId } = req.body || {};
    const currentStudentId = req.user.id;

    if (!siblingId) {
      return res.status(400).json({ success: false, message: "Sibling ID parameter is required." });
    }

    const currentStudent = await Student.findOne({
      $or: [{ _id: currentStudentId }, { user: currentStudentId }]
    });

    if (!currentStudent) {
      return res.status(404).json({ success: false, message: "Current student account context not found." });
    }

    await Student.findByIdAndUpdate(currentStudent._id, {
      $pull: { linkedSiblings: siblingId }
    });

    await Student.findByIdAndUpdate(siblingId, {
      $pull: { linkedSiblings: currentStudent._id }
    });

    const updatedStudent = await Student.findById(currentStudent._id)
      .populate('linkedSiblings', 'firstName lastName surname name currentClass assignedClass admissionNo passportPhoto campus');

    return res.status(200).json({
      success: true,
      message: "Sibling account successfully unlinked.",
      linkedSiblings: updatedStudent.linkedSiblings || []
    });
  } catch (error) {
    console.error("💥 Unlink sibling exception:", error);
    return res.status(500).json({
      success: false,
      message: "Server error occurred while unlinking sibling account.",
      error: error.message
    });
  }
};