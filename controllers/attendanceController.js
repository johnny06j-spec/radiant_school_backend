// controllers/attendanceController.js
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';

/**
 * @route   GET /api/attendance/sheet
 * @desc    Fetch student roster for a specific class on a target date with existing status
 */
export const getClassAttendanceSheet = async (req, res) => {
  try {
    const { className, date } = req.query;
    const user = req.user;

    if (!className || !date) {
      return res.status(400).json({ success: false, message: "Class name and target date are required." });
    }

    // 🔒 Security Permission Guard: Must be Class Teacher of this specific class OR Admin
    if (user.role !== 'admin' && (!user.isClassTeacher || user.classTeacherOf !== className.trim())) {
      return res.status(403).json({
        success: false,
        message: `Permission Denied: You are not authorized as the official Class Teacher for ${className}.`
      });
    }

    // 1. Fetch active students in this class
    const students = await Student.find({ currentClass: className.trim() }).sort({ name: 1 }).lean();

    // 2. Fetch attendance document if already marked for this date
    const existingRegister = await Attendance.findOne({
      className: className.trim(),
      date: date.trim()
    }).lean();

    const existingMap = {};
    if (existingRegister && existingRegister.records) {
      existingRegister.records.forEach(r => {
        existingMap[r.student.toString()] = r;
      });
    }

    // 3. Build active attendance sheet
    const sheet = students.map(st => {
      const rec = existingMap[st._id.toString()] || {};
      return {
        studentId: st._id,
        name: st.name,
        admissionNo: st.admissionNo || st.regNumber || 'N/A',
        status: rec.status || 'PRESENT',
        remark: rec.remark || ''
      };
    });

    return res.status(200).json({
      success: true,
      className,
      date,
      totalStudents: students.length,
      isSubmitted: Boolean(existingRegister),
      records: sheet
    });

  } catch (error) {
    console.error("💥 Attendance sheet fetch error:", error);
    return res.status(500).json({ success: false, message: "Error fetching attendance sheet.", error: error.message });
  }
};

/**
 * @route   POST /api/attendance/submit
 * @desc    Save daily attendance register for a class
 */
export const submitClassAttendance = async (req, res) => {
  try {
    const { className, date, records } = req.body;
    const user = req.user;

    if (!className || !date || !Array.isArray(records)) {
      return res.status(400).json({ success: false, message: "Invalid attendance register payload." });
    }

    // 🔒 Security Permission Guard
    if (user.role !== 'admin' && (!user.isClassTeacher || user.classTeacherOf !== className.trim())) {
      return res.status(403).json({
        success: false,
        message: `Permission Denied: You are not authorized to mark attendance for ${className}.`
      });
    }

    const formattedRecords = records.map(r => ({
      student: r.studentId,
      name: r.name,
      admissionNo: r.admissionNo,
      status: r.status || 'PRESENT',
      remark: r.remark || ''
    }));

    const attendanceDoc = await Attendance.findOneAndUpdate(
      { className: className.trim(), date: date.trim() },
      {
        $set: {
          className: className.trim(),
          date: date.trim(),
          recordedBy: user._id || user.id,
          records: formattedRecords
        }
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: `Daily attendance for ${className} on ${date} saved successfully.`,
      attendance: attendanceDoc
    });

  } catch (error) {
    console.error("💥 Attendance submit exception:", error);
    return res.status(500).json({ success: false, message: "Failed to submit attendance.", error: error.message });
  }
};