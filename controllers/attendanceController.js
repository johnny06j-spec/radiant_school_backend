// controllers/attendanceController.js
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import User from '../models/User.js';

/**
 * Helper to check if logged-in teacher is assigned to the class
 */
const verifyClassTeacher = (reqUser, targetClass) => {
  // Allow system admins or executive users bypass
  if (reqUser.role === 'Admin' || reqUser.role === 'Executive') return true;
  
  // Verify assigned class matches target class
  const assigned = reqUser.assignedClass || reqUser.classTeacherOf;
  if (!assigned) return false;
  
  return assigned.trim().toLowerCase() === targetClass.trim().toLowerCase();
};

/**
 * GET /api/attendance/class-sheet
 */
export const getClassAttendanceSheet = async (req, res) => {
  try {
    const { className, date, sessionPeriod = 'Morning', campus } = req.query;

    if (!className) {
      return res.status(400).json({ success: false, message: 'Class name is required.' });
    }

    // 🔒 Class Teacher Access Lock
    if (!verifyClassTeacher(req.user, className)) {
      return res.status(403).json({
        success: false,
        isNotClassTeacher: true,
        message: `Access denied. Only the assigned Class Teacher for ${className} can manage attendance.`
      });
    }

    const activeCampus = campus || req.user?.campus || 'Emerald Campus';
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const students = await Student.find({ currentClass: className, campus: activeCampus })
      .select('name surname firstName admissionNo passportPhoto')
      .sort({ surname: 1, firstName: 1 })
      .lean();

    const existingAttendance = await Attendance.find({
      className,
      campus: activeCampus,
      sessionPeriod,
      date: {
        $gte: targetDate,
        $lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
      }
    }).lean();

    const attendanceMap = new Map(existingAttendance.map(a => [a.studentId.toString(), a]));

    const formattedList = students.map(st => {
      const record = attendanceMap.get(st._id.toString());
      return {
        studentId: st._id,
        name: st.name || `${st.surname || ''} ${st.firstName || ''}`.trim(),
        admissionNo: st.admissionNo,
        status: record ? record.status : 'Present',
        remark: record ? record.remark : ''
      };
    });

    return res.status(200).json({ success: true, data: formattedList });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/attendance/save
 */
export const saveClassAttendance = async (req, res) => {
  try {
    const { className, date, sessionPeriod, term, session, campus, records } = req.body;

    // 🔒 Class Teacher Access Lock
    if (!verifyClassTeacher(req.user, className)) {
      return res.status(403).json({
        success: false,
        message: `Unauthorized attempt. You are not assigned as Class Teacher for ${className}.`
      });
    }

    const classTeacherId = req.user._id;
    const activeCampus = campus || req.user?.campus || 'Emerald Campus';

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const bulkOps = records.map(rec => ({
      updateOne: {
        filter: { 
          studentId: rec.studentId, 
          date: targetDate, 
          sessionPeriod: sessionPeriod || 'Morning' 
        },
        update: {
          $set: {
            classTeacherId,
            className,
            campus: activeCampus,
            term,
            session,
            status: rec.status,
            remark: rec.remark || ''
          }
        },
        upsert: true
      }
    }));

    await Attendance.bulkWrite(bulkOps);
    return res.status(200).json({ success: true, message: 'Attendance saved successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};