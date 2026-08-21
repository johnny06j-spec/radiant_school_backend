// controllers/financeHelpers.js

/**
 * Normalize class names (converting Roman numerals, Grade, Primary, and spaces to standard numbers)
 */
export const normalizeClassName = (className) => {
  if (!className) return "";
  let normalized = className.trim().toUpperCase();
  return normalized
    .replace(/\bKG\s*I\b/g, 'KG 1')
    .replace(/\bKG\s*II\b/g, 'KG 2')
    .replace(/\bKG\s*III\b/g, 'KG 3')
    .replace(/\bPRIMARY\s*/g, 'BASIC ')
    .replace(/\bGRADE\s*/g, 'BASIC ')
    .replace(/\bJSS\s*I\b/g, 'JSS 1')
    .replace(/\bJSS\s*II\b/g, 'JSS 2')
    .replace(/\bJSS\s*III\b/g, 'JSS 3')
    .replace(/\bSSS\s*I\b/g, 'SSS 1')
    .replace(/\bSSS\s*II\b/g, 'SSS 2')
    .replace(/\bSSS\s*III\b/g, 'SSS 3');
};

/**
 * Extract the starting four-digit year from a session string (e.g., "2026/2027" -> 2026)
 */
export const getSessionStartYear = (sessionStr) => {
  if (!sessionStr) return 0;
  const match = String(sessionStr).match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Determine chronological weight for academic terms
 */
export const getTermWeight = (termName) => {
  if (!termName) return 0;
  const normalized = termName.trim().toLowerCase();
  if (normalized.includes('first') || normalized.includes('1st')) return 1;
  if (normalized.includes('second') || normalized.includes('2nd')) return 2;
  if (normalized.includes('third') || normalized.includes('3rd')) return 3;
  return 0;
};

/**
 * Determine if a term/session is older than the target term/session
 */
export const isOlderTerm = (compSession, compTerm, targetSession, targetTerm) => {
  if (compSession === targetSession && compTerm === targetTerm) return false;
  
  const compYear = getSessionStartYear(compSession);
  const targetYear = getSessionStartYear(targetSession);

  if (compYear !== targetYear) {
    return compYear < targetYear;
  }

  return getTermWeight(compTerm) < getTermWeight(targetTerm);
};

/**
 * 🔒 CORE ENROLLMENT GUARDIAN:
 * Determines if a student was active/enrolled during a target session/term.
 */
export const isStudentEnrolledInTerm = (student, targetSession, targetTerm) => {
  if (!student) return false;

  const intakeSession = String(
    student.intakeSession || 
    student.admissionSession || 
    student.admittedSession || 
    ''
  ).trim();

  const intakeTerm = String(
    student.intakeTerm || 
    student.admissionTerm || 
    student.admittedTerm || 
    'First Term'
  ).trim();

  const intakeYear = getSessionStartYear(intakeSession);
  const targetYear = getSessionStartYear(targetSession);

  // Case 1: Target fee structure belongs to a session BEFORE the student joined -> NOT ENROLLED
  if (targetYear < intakeYear) {
    return false;
  }

  // Case 2: Target fee structure is in the exact INTAKE SESSION -> Check term weight
  if (targetYear === intakeYear) {
    const intakeTermWeight = getTermWeight(intakeTerm);
    const targetTermWeight = getTermWeight(targetTerm);
    
    // Target fee term is prior to student's intake term -> NOT ENROLLED
    if (targetTermWeight < intakeTermWeight) {
      return false;
    }
  }

  // Case 3: Target fee structure is in a session AFTER the student joined -> ENROLLED
  return true;
};