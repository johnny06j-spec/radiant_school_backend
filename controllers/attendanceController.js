// controllers/attendanceController.js
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import User from '../models/User.js';

/**
 * Helper to check if logged-in teacher is assigned to the class
 */
const verifyClassTeacher = (reqUser, targetClass) => {
  if (!reqUser) return false;

  // 1. Executive / Admin Role Bypass
  const userRole = reqUser.role?.toLowerCase() || '';
  if (['admin', 'executive', 'headmaster', 'principal'].includes(userRole)) {
    return true;
  }

  // 2. Primary / Nursery Auto-Assignment Rule
  // Primary teachers automatically manage attendance for their assigned classroom
  const isPrimary = reqUser.schoolSection === 'PRIMARY' || reqUser.schoolSection === 'NURSERY';
  const assigned = reqUser.assignedClass || reqUser.classTeacherOf;

  if (isPrimary && assigned) {
    // If selecting their primary class or if primary teacher has access to their class sheet
    if (assigned.trim().toLowerCase() === targetClass.trim().toLowerCase()) {
      return true;
    }
  }

  // 3. Secondary Explicit Assignment Rule
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
        // 🔑 Default to empty string so it shows as "-- Select --" / Unmarked
        status: record ? record.status : '',
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

/**
 * GET /api/attendance/weekly-report
 */
export const getWeeklyReportData = async (req, res) => {
  try {
    const { className, startDate, endDate, campus } = req.query;
    const activeCampus = campus || req.user?.campus || 'Emerald Campus';

    const start = new Date(startDate || Date.now());
    const end = new Date(endDate || Date.now());
    end.setHours(23, 59, 59, 999);

    const students = await Student.find({ currentClass: className, campus: activeCampus })
      .select('name surname firstName admissionNo')
      .sort({ surname: 1 })
      .lean();

    const attendanceRecords = await Attendance.find({
      className,
      campus: activeCampus,
      date: { $gte: start, $lte: end }
    }).lean();

    const reportData = students.map(st => {
      const studentLogs = attendanceRecords.filter(r => r.studentId.toString() === st._id.toString());
      
      let present = 0, absent = 0, late = 0, excused = 0;
      studentLogs.forEach(log => {
        if (log.status === 'Present') present++;
        if (log.status === 'Absent') absent++;
        if (log.status === 'Late') late++;
        if (log.status === 'Excused') excused++;
      });

      const totalValidDays = present + absent + late + excused;
      const attendancePercentage = totalValidDays > 0 
        ? Math.round(((present + late + excused) / totalValidDays) * 100) 
        : 100;

      return {
        studentId: st._id,
        name: st.name || `${st.surname || ''} ${st.firstName || ''}`.trim(),
        admissionNo: st.admissionNo,
        present,
        absent,
        late,
        excused,
        attendancePercentage,
        logs: studentLogs
      };
    });

    return res.status(200).json({ success: true, data: reportData });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/attendance/student-portal
 */
export const getStudentAttendanceHistory = async (req, res) => {
  try {
    const studentId = req.user?._id || req.query.studentId;
    const { term, session } = req.query;

    const filter = { studentId };
    if (term) filter.term = term;
    if (session) filter.session = session;

    const records = await Attendance.find(filter).sort({ date: -1 }).lean();

    let present = 0, late = 0, absent = 0, excused = 0;
    records.forEach(r => {
      if (r.status === 'Present') present++;
      if (r.status === 'Late') late++;
      if (r.status === 'Absent') absent++;
      if (r.status === 'Excused') excused++;
    });

    const total = records.length;
    const percentage = total > 0 ? Math.round(((present + late + excused) / total) * 100) : 100;

    return res.status(200).json({
      success: true,
      summary: { present, late, absent, excused, percentage, totalDays: total },
      records
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};