// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * 🔐 Hardened Global Cookie & JWT Verification Gatekeeper
 */
export const verifyToken = async (req, res, next) => {
  try {
    // 1. Extract token from secure httpOnly cookie
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required. No session cookie detected." 
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("CRITICAL CONFIG ERROR: process.env.JWT_SECRET is undefined.");
      return res.status(500).json({ success: false, message: "Internal server authentication configuration error." });
    }

    // 2. Verify algorithm and signature
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });

    // 3. Fetch user directly from DB to check live active status and roles
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account associated with this session no longer exists in the registry."
      });
    }

    // 4. Reject deactivated or unverified accounts immediately
    if (user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Account is deactivated or unverified. Contact administrator."
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("JWT Verification Middleware Failure:", err.message);
    return res.status(401).json({ 
      success: false, 
      message: "Session expired or invalid authorization token signature." 
    });
  }
};

/**
 * 🛡️ Role Gate: Administrative Clearance Enforcer
 */
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role?.toLowerCase() === "admin") {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Administrative clearance levels required." 
    });
  }
};

/**
 * 🧑‍🎓 Role Gate: Student Account Enforcer
 */
export const isStudent = (req, res, next) => {
  if (req.user && req.user.role?.toLowerCase() === "student") {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Student account clearance required." 
    });
  }
};

/**
 * 🛡️ Role Gate: Teacher & Admin Enforcer
 */
export const protectTeacher = (req, res, next) => {
  const userRole = req.user?.role?.toLowerCase();
  if (['teacher', 'class teacher', 'admin', 'executive'].includes(userRole)) {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Teacher or Administrative clearance required." 
    });
  }
};

/**
 * 🧑‍🎓 Role Gate: Student Account Token Enforcer
 */
export const protectStudent = (req, res, next) => {
  const userRole = req.user?.role?.toLowerCase();
  if (userRole === 'student' || req.user?.admissionNo) {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Student account token context signature required." 
    });
  }
};