// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * 🔐 Global JWT Verification Gatekeeper
 * Verifies token signature integrity and authenticates the user context.
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
    
    // Safely pull configuration context
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("CRITICAL CONFIG ERROR: process.env.JWT_SECRET is undefined. Check dotenv configuration flow.");
    }

    // Decode token container
    const decoded = jwt.verify(token, jwtSecret || "YOUR_FALLBACK_JWT_SECRET");
    
    // Check database to ensure user layer still exists
    const userExists = await User.findById(decoded.id);
    if (!userExists) {
      return res.status(401).json({
        success: false,
        message: "User account associated with this session no longer exists in the registry."
      });
    }

    // Append standard payload back to the request stream
    req.user = {
      id: decoded.id,
      role: decoded.role, 
      username: decoded.username
    };

    next();
  } catch (err) {
    console.error("JWT Verification Middleware Failure:", err.message);
    return res.status(403).json({ 
      success: false, 
      message: "Session expired or invalid authorization token signature signature." 
    });
  }
};

/**
 * 🛡️ Strict Role Gate: Admin Enforcer
 */
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Administrative clearance levels required." 
    });
  }
};

/**
 * 🧑‍🎓 Strict Role Gate: Student Enforcer
 */
export const isStudent = (req, res, next) => {
  if (req.user && req.user.role === "student") {
    next();
  } else {
    return res.status(403).json({ 
      success: false, 
      message: "Forbidden Access. Student account token context signature required." 
    });
  }
};