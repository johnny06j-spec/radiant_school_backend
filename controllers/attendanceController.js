// controllers/attendanceController.js
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import User from '../models/User.js';

/**
 * Helper to check if logged-in teacher is assigned to the class
 */
const verifyClassTeacher = (reqUser, targetClass = '') => {
  if (!reqUser) return false;

  // 1. Executive / Admin / Management Role Bypass
  const userRole = reqUser.role?.toLowerCase() || '';
  if (['admin', 'executive', 'headmaster', 'principal'].includes(userRole)) {
    return true;
  }

  // Helper function to strip spaces, special characters, and lowercase for robust comparison
  const normalize = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const targetNorm = normalize(targetClass);
  if (!targetNorm) return false;

  // 2. Gather ALL class fields attached to teacher profile
  const assignedClassesList = [
    reqUser.classTeacherOf,
    reqUser.assignedClass,
    ...(Array.isArray(reqUser.assignedClasses) ? reqUser.assignedClasses : []),
    ...(Array.isArray(reqUser.subjectAllocations) ? reqUser.subjectAllocations.map(s => s.className) : [])
  ].filter(Boolean).map(c => normalize(c));

  // 🟢 DIRECT MATCH: If targetClass matches ANY assigned class field, grant immediate access!
  if (assignedClassesList.includes(targetNorm)) {
    return true;
  }

  // 3. Primary / Nursery Section Fallback Rule
  const sectionStr = `${reqUser.schoolSection || ''} ${reqUser.section || ''} ${reqUser.department || ''}`.toLowerCase();
  const isPrimaryOrNursery = /primary|nursery|basic|kg|creche|playgroup|pre-school/i.test(sectionStr);

  if (isPrimaryOrNursery) {
    // If no explicit class assignment exists on primary account, default to open access for primary teachers
    if (assignedClassesList.length === 0 || assignedClassesList.includes('na')) {
      return true;
    }
  }

  return false;
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
    const { className, startDate, endDate, sessionPeriod = 'Morning', campus } = req.query;
    const activeCampus = campus || req.user?.campus || 'Emerald Campus';

    const start = new Date(startDate || Date.now());
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate || Date.now());
    end.setHours(23, 59, 59, 999);

    const students = await Student.find({ currentClass: className, campus: activeCampus })
      .select('name surname firstName admissionNo')
      .sort({ surname: 1, firstName: 1 })
      .lean();

    const attendanceRecords = await Attendance.find({
      className,
      campus: activeCampus,
      sessionPeriod,
      date: { $gte: start, $lte: end }
    }).lean();

    const reportData = students.map(st => {
      const studentLogs = attendanceRecords.filter(r => r.studentId.toString() === st._id.toString());
      
      // Index attendance status by YYYY-MM-DD string
      const logsByDate = {};
      studentLogs.forEach(log => {
        const dStr = new Date(log.date).toISOString().split('T')[0];
        logsByDate[dStr] = log.status;
      });

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
        logsByDate,
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
    const { term: rawTerm, session: rawSession } = req.query;

    let targetStudentId = req.query.studentId;

    if (!targetStudentId && req.user) {
      if (req.user.studentId) {
        targetStudentId = req.user.studentId;
      } else {
        const studentProfile = await Student.findOne({ 
          $or: [{ user: req.user._id }, { _id: req.user._id }] 
        }).select('_id').lean();

        targetStudentId = studentProfile ? studentProfile._id : req.user._id;
      }
    }

    let termFilter = rawTerm;
    let sessionFilter = rawSession;

    if (rawTerm && rawTerm.includes('(')) {
      const parts = rawTerm.split('(');
      termFilter = parts[0].trim();
      sessionFilter = parts[1].replace(')', '').trim();
    }

    const filter = {
      $or: [
        { studentId: targetStudentId },
        { student: targetStudentId }
      ]
    };

    if (termFilter) filter.term = termFilter;
    if (sessionFilter) filter.session = sessionFilter;

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
    console.error("💥 Error fetching student attendance history:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};