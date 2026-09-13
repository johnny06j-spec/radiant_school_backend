// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * 🔐 Global JWT Verification Gatekeeper
 */
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        message: "Access Denied. No token authorization header detected." 
      });
    }

    const token = authHeader.split(" ")[1];
    const jwtSecret = process.env.JWT_SECRET;
    
    if (!jwtSecret) {
      console.error("CRITICAL CONFIG ERROR: process.env.JWT_SECRET is undefined. Check dotenv configuration flow.");
    }

    const decoded = jwt.verify(token, jwtSecret || "YOUR_FALLBACK_JWT_SECRET");
    
    const userExists = await User.findById(decoded.id);
    if (!userExists) {
      return res.status(401).json({
        success: false,
        message: "User account associated with this session no longer exists in the registry."
      });
    }

    req.user = userExists;
    next();
  } catch (err) {
    console.error("JWT Verification Middleware Failure:", err.message);
    return res.status(403).json({ 
      success: false, 
      message: "Session expired or invalid authorization token signature." 
    });
  }
};

/**
 * 🛡️ Role Gate: Teacher & Admin Enforcer
 */
export const protectTeacher = async (req, res, next) => {
  await verifyToken(req, res, () => {
    const userRole = req.user?.role?.toLowerCase();
    if (['teacher', 'class teacher', 'admin', 'executive'].includes(userRole)) {
      next();
    } else {
      res.status(403).json({ 
        success: false, 
        message: "Forbidden Access. Teacher or Administrative clearance required." 
      });
    }
  });
};

/**
 * 🧑‍🎓 Role Gate: Student Enforcer
 */
export const protectStudent = async (req, res, next) => {
  await verifyToken(req, res, () => {
    const userRole = req.user?.role?.toLowerCase();
    if (userRole === 'student' || req.user?.admissionNo) {
      next();
    } else {
      res.status(403).json({ 
        success: false, 
        message: "Forbidden Access. Student account token context signature required." 
      });
    }
  });
};

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

export const isStudent = (req, res, next) => {
  if (req.user && req.user.role?.toLowerCase() === "student") {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Student account token context signature required." 
    });
  }
};