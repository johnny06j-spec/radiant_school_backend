// controllers/student/studentHelpers.js
import SystemConfig from '../../models/SystemConfig.js';

/**
 * Helper to extract the starting year from a session string (e.g., "2026/2027" -> 2026)
 */
export const getSessionStartYear = (sessionStr) => {
  if (!sessionStr) return 0;
  const match = String(sessionStr).match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Helper to determine term chronological weight
 */
export const getTermOrder = (termName) => {
  if (!termName) return 0;
  const normalized = String(termName).trim().toLowerCase();
  if (normalized.includes('first') || normalized.includes('1st')) return 1;
  if (normalized.includes('second') || normalized.includes('2nd')) return 2;
  if (normalized.includes('third') || normalized.includes('3rd')) return 3;
  return 0;
};

/**
 * Helper to normalize common Roman numeral variations and class formats to match fee templates
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
 * Determine if a term/session is older than the target term/session
 */
export const isOlderTerm = (compSession, compTerm, targetSession, targetTerm) => {
  if (compSession === targetSession && compTerm === targetTerm) return false;
  
  const compYear = getSessionStartYear(compSession);
  const targetYear = getSessionStartYear(targetSession);

  if (compYear !== targetYear) {
    return compYear < targetYear;
  }

  return getTermOrder(compTerm) < getTermOrder(targetTerm);
};

/**
 * Helper to fetch System Config from the Database.
 */
export const getSystemConfig = async () => {
  try {
    const config = await SystemConfig.findOne({}).sort({ createdAt: -1 });
    if (!config) {
      return { currentSession: "2026/2027", currentTerm: "First Term" };
    }
    return {
      currentSession: config.currentSession,
      currentTerm: config.currentTerm
    };
  } catch (err) {
    console.error("⚠️ Error fetching SystemConfig model. Falling back:", err);
    return { currentSession: "2026/2027", currentTerm: "First Term" };
  }
};

/**
 * Sort function to order structures chronologically
 */
export const compareStructuresChronologically = (a, b) => {
  const yearA = getSessionStartYear(a.session);
  const yearB = getSessionStartYear(b.session);
  if (yearA !== yearB) return yearA - yearB;
  return getTermOrder(a.term) - getTermOrder(b.term);
};