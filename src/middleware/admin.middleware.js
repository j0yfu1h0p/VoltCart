import User from "../models/user.model.js";

export const admin_middleware = async (req, res, next) => {
  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const user = await User.findById(user_id).select("role");

    if (!user || user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    req.admin_user = user;
    next();
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
