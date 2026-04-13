import User from "../models/user.model.js";
import { log_auth_event } from "../utils/auth-logger.util.js";
import { verify_token } from "../utils/util.js";

const is_public_request = (req) => {
  const method = String(req.method || "").toUpperCase();
  const path = String(req.path || "");
  const original = String(req.originalUrl || "");

  if (method === "GET" && (path === "/" || original === "/")) {
    return true;
  }

  // Keep product listing and product details publicly readable.
  if (
    method === "GET" &&
    (path === "/products" ||
      /^\/products\/[A-Za-z0-9_-]+$/.test(path) ||
      original === "/products" ||
      /^\/products\/[A-Za-z0-9_-]+$/.test(original))
  ) {
    return true;
  }

  return false;
};

/**
 * Checks the Authorization header, verifies the JWT, and attaches the decoded payload to the request.
 *
 * @param  req - Express request object.
 * @param  res - Express response object.
 * @param  next - Function that passes control to the next handler.
 * @returns Promise   Calls next() when the token is valid.
 */
export const auth_middleware = async (req, res, next) => {
  if (is_public_request(req)) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Authorization header missing" });
  }

  // Usually token is in the format "Bearer <token>"
  const token = authHeader.split(" ")[1];

  try {
    // eslint-disable-next-line no-undef
    const decoded = verify_token(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.user_id).select(
      "_id email role account_status",
    );

    if (!user) {
      await log_auth_event(req, {
        event_type: "middleware.auth",
        status: "failure",
        severity: "warning",
        user_id: decoded.user_id,
        message: "Auth middleware rejected missing user",
      });

      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    if (user.account_status !== "active") {
      await log_auth_event(req, {
        event_type: "middleware.auth",
        status: "failure",
        severity: "warning",
        user_id: user._id,
        email: user.email,
        message: "Auth middleware blocked inactive account",
        metadata: { account_status: user.account_status },
      });

      return res.status(403).json({
        success: false,
        message: `Account is ${user.account_status}`,
      });
    }

    // You can attach decoded info to request for future use
    req.user = {
      ...decoded,
      user_id: user._id,
      email: user.email,
      role: user.role,
      account_status: user.account_status,
    };

    next(); // Proceed to next middleware or route
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
