// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * 🔐 Hardened Global Cookie & Bearer JWT Verification Gatekeeper
 */
export const verifyToken = async (req, res, next) => {
  try {
    // 1. Extract token from httpOnly cookie OR Authorization Bearer header (iOS Safari fallback)
    let token = req.cookies?.accessToken;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required. No valid session token detected." 
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