import crypto from "node:crypto";
import process from "node:process";

import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";

import AuthEvent from "../models/auth-event.model.js";
import RefreshToken from "../models/refresh-token.model.js";
import User from "../models/user.model.js";
import { log_auth_event } from "../utils/auth-logger.util.js";
import {
  sendMagicLinkEmail,
  sendResetPasswordEmail,
  sendSecurityActivityEmail,
  sendVerificationEmail,
} from "../utils/mail.util.js";
import { generate_token, verify_token } from "../utils/util.js";

const refresh_token_lifetime_ms = 7 * 24 * 60 * 60 * 1000;
const verification_token_lifetime_ms = 24 * 60 * 60 * 1000;
const magic_link_lifetime_ms = 15 * 60 * 1000;

const build_auth_payload = (user) => ({
  user_id: user._id,
  full_name: user.full_name,
  email: user.email,
  role: user.role,
  account_status: user.account_status,
  email_verified: user.email_verified,
  two_factor_enabled: user.two_factor_enabled,
  magic_link_login_required: Boolean(user.magic_link_login_required),
});

const create_auth_tokens = (user) => {
  const payload = build_auth_payload(user);

  const token = generate_token(payload, process.env.JWT_SECRET, "1h");

  const refresh_token = generate_token(
    payload,
    process.env.JWT_REFRESH_SECRET,
    "7d",
  );

  return { token, refresh_token };
};

const get_request_meta = (req) => {
  const forwarded_for = req.headers["x-forwarded-for"];
  const ip_address = Array.isArray(forwarded_for)
    ? forwarded_for[0]
    : typeof forwarded_for === "string"
      ? forwarded_for.split(",")[0].trim()
      : req.ip || null;

  return {
    user_agent: req.get("user-agent") || null,
    ip_address,
    device_name: req.get("x-device-name") || null,
  };
};

const store_refresh_token = async (user_id, refresh_token, req) => {
  await RefreshToken.create({
    user_id,
    token: refresh_token,
    expiresAt: new Date(Date.now() + refresh_token_lifetime_ms),
    last_used_at: new Date(),
    ...get_request_meta(req),
  });
};

const issue_auth_session = async (user, req) => {
  const { token, refresh_token } = create_auth_tokens(user);

  await store_refresh_token(user._id, refresh_token, req);

  return { token, refresh_token };
};

const build_public_user = (user) => ({
  user_id: user._id,
  full_name: user.full_name,
  email: user.email,
  role: user.role,
  account_status: user.account_status,
  email_verified: user.email_verified,
  two_factor_enabled: user.two_factor_enabled,
  magic_link_login_required: Boolean(user.magic_link_login_required),
});

const get_base_url = () =>
  (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const get_web_app_url = () => {
  const configured = (
    process.env.WEB_APP_URL || "http://127.0.0.1:5500/frontend-ui"
  ).replace(/\/$/, "");

  if (/\/frontend-ui$/i.test(configured)) {
    return configured;
  }

  if (/localhost:5500|127\.0\.0\.1:5500/i.test(configured)) {
    return `${configured}/frontend-ui`;
  }

  return configured;
};

const get_client_ip = (req) => {
  const forwarded_for = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded_for)) {
    return forwarded_for[0];
  }

  if (typeof forwarded_for === "string") {
    return forwarded_for.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
};

const send_security_email_safe = async (
  user,
  { title, message, req, should_skip_when_unverified = false },
) => {
  if (!user?.email) {
    return;
  }

  if (should_skip_when_unverified && !user.email_verified) {
    return;
  }

  try {
    await sendSecurityActivityEmail({
      to: user.email,
      name: user.full_name,
      activityTitle: title,
      activityMessage: message,
      ipAddress: get_client_ip(req),
      userAgent: req.get("user-agent") || null,
    });
  } catch (error) {
    console.error("Security activity email error:", error.message);
  }
};

const create_magic_link_token = () => {
  const token = crypto.randomBytes(32).toString("hex");

  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + magic_link_lifetime_ms),
  };
};

const user_is_active = (user) => user.account_status === "active";

const reject_if_user_not_active = async (req, res, user, event_type) => {
  if (user_is_active(user)) {
    return false;
  }

  await log_auth_event(req, {
    event_type,
    status: "failure",
    severity: "warning",
    user_id: user._id,
    email: user.email,
    message: "Account is not active",
    metadata: { account_status: user.account_status },
  });

  res.status(403).json({
    success: false,
    message: `Account is ${user.account_status}. Contact support.`,
  });

  return true;
};

const create_email_verification_token = () => {
  const token = crypto.randomBytes(32).toString("hex");

  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + verification_token_lifetime_ms),
  };
};

const send_verification_email_safe = async (user, verification_token) => {
  try {
    const app_base_url = get_base_url();
    const verification_url = `${app_base_url}/auth/verify-email/${verification_token}`;

    await sendVerificationEmail({
      to: user.email,
      name: user.full_name,
      verificationToken: verification_token,
      verificationUrl: verification_url,
    });
  } catch (error) {
    console.error("Verification email error:", error);
  }
};

const send_verify_email_response = (req, res, statusCode, title, message) => {
  if (req.method === "GET") {
    return res.status(statusCode).send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
        </head>
        <body style="font-family:Arial;background:#f3f4f6;">
          <div style="max-width:560px;margin:50px auto;background:#fff;padding:30px;border-radius:12px;text-align:center;">
            <h1>${title}</h1>
            <p>${message}</p>
          </div>
        </body>
      </html>
    `);
  }

  return res.status(statusCode).json({
    success: statusCode < 400,
    message,
  });
};

const assert_password_match = async (password, hashed_password) => {
  const is_match = await bcrypt.compare(password, hashed_password);

  if (!is_match) {
    return false;
  }

  return true;
};

/**
 * Registers a new user account.
 */
export const register_user = async (req, res) => {
  try {
    const {
      full_name,
      email,
      password,
      magic_link_login_required = false,
    } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
        details: "full_name, email, and password must be provided",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
        details: "A user with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = new User({
      full_name,
      email,
      password: hashedPassword,
      magic_link_login_required: Boolean(magic_link_login_required),
    });

    await newUser.save();

    const verification = create_email_verification_token();

    newUser.email_verification_token = verification.hash;
    newUser.email_verification_expires = verification.expiresAt;
    await newUser.save();

    const { token, refresh_token } = await issue_auth_session(newUser, req);

    await send_verification_email_safe(newUser, verification.token);

    await log_auth_event(req, {
      event_type: "user.register",
      status: "success",
      user_id: newUser._id,
      email: newUser.email,
      message: "User registered successfully",
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: build_public_user(newUser),
      token,
      refresh_token,
      verification_required: true,
    });
  } catch (err) {
    console.error("Register error:", err);
    await log_auth_event(req, {
      event_type: "user.register",
      status: "failure",
      severity: "critical",
      email: req.body?.email || null,
      message: "Registration failed",
      metadata: { error: err.message },
    });
    return res.status(500).json({
      success: false,
      message: "Server error",
      details: "An unexpected error occurred on the server",
    });
  }
};

/**
 * Authenticates a user.
 */
export const user_login = async (req, res) => {
  try {
    const {
      email,
      password,
      otp_code,
      remember_me = false,
      remember_me_token,
    } = req.body; // expecting remember_me as boolean

    const user = await User.findOne({ email }).select(
      "+two_factor_secret +trusted_devices",
    );

    if (!user) {
      await log_auth_event(req, {
        event_type: "user.login",
        status: "failure",
        severity: "warning",
        email,
        message: "User not found during login",
      });
      return res.status(404).json({
        success: false,
        message: "User not found or invalid credentials",
      });
    }

    if (await reject_if_user_not_active(req, res, user, "user.login")) {
      return;
    }

    if (user.magic_link_login_required) {
      await log_auth_event(req, {
        event_type: "user.login",
        status: "failure",
        severity: "warning",
        user_id: user._id,
        email,
        message:
          "Password login blocked because magic-link-only mode is enabled",
      });
      return res.status(403).json({
        success: false,
        message:
          "This account requires magic-link login for security. Please use magic link.",
      });
    }

    const isMatch = await assert_password_match(password, user.password);

    if (!isMatch) {
      await log_auth_event(req, {
        event_type: "user.login",
        status: "failure",
        severity: "warning",
        user_id: user._id,
        email,
        message: "Invalid credentials",
      });
      return res.status(404).json({
        success: false,
        message: "User not found or invalid credentials",
      });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip;
    const user_agent = req.headers["user-agent"] || null;

    if (!Array.isArray(user.trusted_devices)) {
      user.trusted_devices = [];
    }

    const now = new Date();
    user.trusted_devices = user.trusted_devices.filter(
      (device) => device?.expires_at && new Date(device.expires_at) > now,
    );

    let is_trusted_device = false;
    if (typeof remember_me_token === "string" && remember_me_token.trim()) {
      const trimmed_token = remember_me_token.trim();
      const remember_token_hash = crypto
        .createHash("sha256")
        .update(trimmed_token)
        .digest("hex");

      is_trusted_device = user.trusted_devices.some(
        (device) =>
          (device.token === remember_token_hash ||
            device.token === trimmed_token) &&
          device.user_agent === user_agent &&
          device.ip === (ip || null),
      );
    }

    if (user.two_factor_enabled && !is_trusted_device) {
      if (!otp_code) {
        await log_auth_event(req, {
          event_type: "user.login",
          status: "failure",
          severity: "warning",
          user_id: user._id,
          email: user.email,
          message: "Two-factor code required",
        });
        return res.status(401).json({
          success: false,
          message: "Two-factor code is required",
        });
      }

      if (
        typeof user.two_factor_secret !== "string" ||
        !user.two_factor_secret
      ) {
        return res.status(500).json({
          success: false,
          message: "Two-factor secret is invalid or missing",
        });
      }

      const is_valid_otp = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: "base32",
        token: otp_code,
        window: 1,
      });

      if (!is_valid_otp) {
        await log_auth_event(req, {
          event_type: "user.login",
          status: "failure",
          severity: "warning",
          user_id: user._id,
          email: user.email,
          message: "Invalid two-factor code",
        });
        return res.status(401).json({
          success: false,
          message: "Invalid two-factor code",
        });
      }
    }
    let remember_token_hash;
    let remember_token_value;
    if (remember_me) {
      remember_token_value = crypto.randomBytes(32).toString("hex");
      remember_token_hash = crypto
        .createHash("sha256")
        .update(remember_token_value)
        .digest("hex");

      user.trusted_devices.push({
        token: remember_token_hash,
        ip: ip || null,
        user_agent: req.headers["user-agent"],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });
    }

    user.last_login_at = new Date();
    await user.save();

    const { token, refresh_token } = await issue_auth_session(user, req);

    await log_auth_event(req, {
      event_type: "user.login",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "User logged in successfully",
      metadata: {
        remember_me: Boolean(remember_me),
        trusted_device: is_trusted_device,
      },
    });

    await send_security_email_safe(user, {
      title: "New login detected",
      message: "A new login to your account was detected.",
      req,
      should_skip_when_unverified: false,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: build_public_user(user),
      token,
      refresh_token,
      remember_me_token: remember_me ? remember_token_value : null,
    });
  } catch (error) {
    console.error("Login error:", error);
    await log_auth_event(req, {
      event_type: "user.login",
      status: "failure",
      severity: "critical",
      email: req.body?.email || null,
      message: "Unexpected login error",
      metadata: { error: error.message },
    });
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Hash reset token
 */
const hash_reset_token = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Reset page builder
 */
const build_reset_password_page = ({
  title,
  message,
  token,
  show_form = true,
}) => {
  const form_html = show_form
    ? `
      <form method="POST" action="/auth/reset-password/${token}" style="display:grid;gap:12px;max-width:360px;margin:24px auto 0;">
        <label style="display:grid;gap:6px;text-align:left;">
          <span>New password</span>
          <input type="password" name="password" minlength="6" required style="padding:12px;border:1px solid #d1d5db;border-radius:10px;" />
        </label>
        <label style="display:grid;gap:6px;text-align:left;">
          <span>Confirm password</span>
          <input type="password" name="confirm_password" minlength="6" required style="padding:12px;border:1px solid #d1d5db;border-radius:10px;" />
        </label>
        <button type="submit" style="padding:12px 16px;border:none;border-radius:10px;background:#111827;color:#fff;font-weight:600;cursor:pointer;">Update password</button>
      </form>
    `
    : "";

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
      </head>
      <body style="font-family:Arial;background:#f3f4f6;">
        <div style="max-width:600px;margin:50px auto;background:#fff;padding:30px;border-radius:12px;text-align:center;">
          <h1>${title}</h1>
          <p>${message}</p>
          ${form_html}
        </div>
      </body>
    </html>
  `;
};

/**
 * Request reset
 */
export const request_password_reset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      await log_auth_event(req, {
        event_type: "user.password_reset.request",
        status: "warning",
        email,
        message: "Password reset requested for non-existing email",
      });
      return res.status(200).json({
        success: true,
        message: "If the email exists, a password reset link has been sent.",
      });
    }

    const reset_token = crypto.randomBytes(32).toString("hex");
    const reset_token_hash = hash_reset_token(reset_token);
    const reset_token_expires = new Date(Date.now() + 60 * 60 * 1000);

    user.password_reset_token = reset_token_hash;
    user.password_reset_expires = reset_token_expires;
    await user.save();

    const app_base_url = get_base_url();
    const reset_url = `${app_base_url}/auth/reset-password/${reset_token}`;

    try {
      await sendResetPasswordEmail({
        to: user.email,
        name: user.full_name,
        resetUrl: reset_url,
      });
    } catch (mail_error) {
      user.password_reset_token = null;
      user.password_reset_expires = null;
      await user.save();
      throw mail_error;
    }

    await log_auth_event(req, {
      event_type: "user.password_reset.request",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "Password reset link sent",
    });

    return res.status(200).json({
      success: true,
      message: "If the email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Password reset request error:", error);
    await log_auth_event(req, {
      event_type: "user.password_reset.request",
      status: "failure",
      severity: "critical",
      email: req.body?.email || null,
      message: "Password reset request failed",
      metadata: { error: error.message },
    });
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Show reset form
 */
export const show_reset_password_form = async (req, res) => {
  try {
    const { token } = req.params;
    const reset_token_hash = hash_reset_token(token);

    const user = await User.findOne({
      password_reset_token: reset_token_hash,
      password_reset_expires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send(
        build_reset_password_page({
          title: "Reset link expired",
          message: "Request a new reset link.",
          token: "",
          show_form: false,
        }),
      );
    }

    return res.status(200).send(
      build_reset_password_page({
        title: "Set new password",
        message: "Enter a new password.",
        token,
        show_form: true,
      }),
    );
  } catch {
    return res.status(500).send(
      build_reset_password_page({
        title: "Error",
        message: "Unable to load page.",
        token: "",
        show_form: false,
      }),
    );
  }
};

/**
 * Reset password
 */
export const reset_password = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirm_password } = req.body;

    if (!password || !confirm_password) {
      return res.status(400).send(
        build_reset_password_page({
          title: "Missing fields",
          message: "Both fields required.",
          token,
          show_form: true,
        }),
      );
    }

    if (password !== confirm_password) {
      return res.status(400).send(
        build_reset_password_page({
          title: "Mismatch",
          message: "Passwords do not match.",
          token,
          show_form: true,
        }),
      );
    }

    const reset_token_hash = hash_reset_token(token);

    const user = await User.findOne({
      password_reset_token: reset_token_hash,
      password_reset_expires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send(
        build_reset_password_page({
          title: "Expired",
          message: "Reset link expired.",
          token: "",
          show_form: false,
        }),
      );
    }

    const hashed_password = await bcrypt.hash(password, 12);

    user.password = hashed_password;
    user.password_reset_token = null;
    user.password_reset_expires = null;

    await user.save();

    await log_auth_event(req, {
      event_type: "user.password_reset.complete",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "Password reset completed",
    });

    await send_security_email_safe(user, {
      title: "Password changed",
      message: "Your account password was changed using a reset link.",
      req,
    });

    return res.status(200).send(
      build_reset_password_page({
        title: "Success",
        message: "Password updated.",
        token: "",
        show_form: false,
      }),
    );
  } catch (error) {
    await log_auth_event(req, {
      event_type: "user.password_reset.complete",
      status: "failure",
      severity: "critical",
      message: "Password reset completion failed",
      metadata: { error: error.message },
    });
    return res.status(500).send(
      build_reset_password_page({
        title: "Error",
        message: "Could not reset password.",
        token: "",
        show_form: false,
      }),
    );
  }
};

export const get_current_user = async (req, res) => {
  try {
    const user = await User.findById(req.user.user_id).select(
      "-password -password_reset_token -password_reset_expires -email_verification_token -email_verification_expires -two_factor_secret",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (
      await reject_if_user_not_active(req, res, user, "user.password_change")
    ) {
      return;
    }

    return res.status(200).json({
      success: true,
      data: build_public_user(user),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const update_profile = async (req, res) => {
  try {
    const { full_name, email, magic_link_login_required } = req.body;

    const user = await User.findById(req.user.user_id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Email already exists",
        });
      }

      const verification = create_email_verification_token();

      user.email = email;
      user.email_verified = false;
      user.email_verification_token = verification.hash;
      user.email_verification_expires = verification.expiresAt;

      await user.save();
      await send_verification_email_safe(user, verification.token);
    }

    if (full_name) {
      user.full_name = full_name;
    }

    if (typeof magic_link_login_required === "boolean") {
      user.magic_link_login_required = magic_link_login_required;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: build_public_user(user),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const change_password = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: "All password fields are required",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const user = await User.findById(req.user.user_id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentPasswordMatches = await bcrypt.compare(
      current_password,
      user.password,
    );

    if (!currentPasswordMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is invalid",
      });
    }

    user.password = await bcrypt.hash(new_password, 12);
    await user.save();
    await RefreshToken.deleteMany({ user_id: user._id });

    await log_auth_event(req, {
      event_type: "user.password_change",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "User password changed",
    });

    await send_security_email_safe(user, {
      title: "Password changed",
      message: "Your account password was changed successfully.",
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    await log_auth_event(req, {
      event_type: "user.password_change",
      status: "failure",
      severity: "critical",
      user_id: req.user?.user_id || null,
      message: "Password change failed",
      metadata: { error: error.message },
    });
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const delete_account = async (req, res) => {
  try {
    await RefreshToken.deleteMany({ user_id: req.user.user_id });
    await User.deleteOne({ _id: req.user.user_id });

    return res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const verify_email = async (req, res) => {
  try {
    const token = req.params.token || req.body.token || req.query.token;

    if (!token) {
      return send_verify_email_response(
        req,
        res,
        400,
        "Invalid verification",
        "Verification token is required",
      );
    }

    const token_hash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      email_verification_token: token_hash,
      email_verification_expires: { $gt: new Date() },
    });

    if (!user) {
      return send_verify_email_response(
        req,
        res,
        400,
        "Verification failed",
        "Verification token is invalid or expired",
      );
    }

    user.email_verified = true;
    user.email_verification_token = null;
    user.email_verification_expires = null;
    await user.save();

    return send_verify_email_response(
      req,
      res,
      200,
      "Email verified",
      "Email verified successfully",
    );
  } catch {
    return send_verify_email_response(
      req,
      res,
      500,
      "Server error",
      "Could not verify email",
    );
  }
};

export const resend_verification_email = async (req, res) => {
  try {
    const user = await User.findById(req.user.user_id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.email_verified) {
      return res.status(200).json({
        success: true,
        message: "Email already verified",
      });
    }

    const verification = create_email_verification_token();

    user.email_verification_token = verification.hash;
    user.email_verification_expires = verification.expiresAt;
    await user.save();

    await send_verification_email_safe(user, verification.token);

    return res.status(200).json({
      success: true,
      message: "Verification email sent",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const list_sessions = async (req, res) => {
  try {
    const sessions = await RefreshToken.find({
      user_id: req.user.user_id,
      revoked_at: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .select(
        "user_agent ip_address device_name createdAt expiresAt last_used_at",
      );

    return res.status(200).json({
      success: true,
      data: sessions.map((session) => ({
        session_id: session._id,
        user_agent: session.user_agent,
        ip_address: session.ip_address,
        device_name: session.device_name,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        last_used_at: session.last_used_at,
      })),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const delete_session = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedSession = await RefreshToken.findOneAndDelete({
      _id: id,
      user_id: req.user.user_id,
    });

    if (!deletedSession) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Session revoked successfully",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const delete_all_sessions = async (req, res) => {
  try {
    await RefreshToken.deleteMany({ user_id: req.user.user_id });

    return res.status(200).json({
      success: true,
      message: "All sessions revoked successfully",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const enable_two_factor = async (req, res) => {
  try {
    const user = await User.findById(req.user.user_id).select(
      "+two_factor_secret",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const secret = speakeasy.generateSecret({
      name: `${process.env.APP_NAME || "Auth App"} (${user.email})`,
      issuer: process.env.APP_NAME || "Auth App",
    });

    user.two_factor_secret = secret.base32;
    user.two_factor_enabled = false;
    await user.save();

    if (user.account_status !== "active") {
      await RefreshToken.deleteMany({ user_id: user._id });
    }

    return res.status(200).json({
      success: true,
      message: "Two-factor secret generated",
      data: {
        secret: secret.base32,
        otpauth_url: secret.otpauth_url,
      },
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const verify_two_factor = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Code is required",
      });
    }

    const user = await User.findById(req.user.user_id).select(
      "+two_factor_secret",
    );

    if (!user || !user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: "Two-factor setup is missing",
      });
    }

    const is_valid = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: code,
      window: 1,
    });

    if (!is_valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid code",
      });
    }

    user.two_factor_enabled = true;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Two-factor enabled successfully",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const disable_two_factor = async (req, res) => {
  try {
    const { current_password, code } = req.body;

    if (!current_password || !code) {
      return res.status(400).json({
        success: false,
        message: "Current password and code are required",
      });
    }

    const user = await User.findById(req.user.user_id).select(
      "+two_factor_secret",
    );

    if (!user || !user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: "Two-factor is not enabled",
      });
    }

    const passwordMatches = await bcrypt.compare(
      current_password,
      user.password,
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Current password is invalid",
      });
    }

    const is_valid = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: "base32",
      token: code,
      window: 1,
    });

    if (!is_valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid code",
      });
    }

    user.two_factor_enabled = false;
    user.two_factor_secret = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Two-factor disabled successfully",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const list_users = async (req, res) => {
  try {
    const users = await User.find().select(
      "-password -password_reset_token -password_reset_expires -email_verification_token -email_verification_expires -two_factor_secret",
    );

    return res.status(200).json({
      success: true,
      data: users.map((user) => build_public_user(user)),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const get_user_by_id = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "-password -password_reset_token -password_reset_expires -email_verification_token -email_verification_expires -two_factor_secret",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: build_public_user(user),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const update_user_by_id = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "+two_factor_secret",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const {
      full_name,
      email,
      role,
      email_verified,
      two_factor_enabled,
      account_status,
    } = req.body;

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Email already exists",
        });
      }

      user.email_verified = false;
      user.email_verification_token = null;
      user.email_verification_expires = null;
    }

    if (typeof full_name === "string") {
      user.full_name = full_name;
    }

    if (typeof email === "string") {
      user.email = email;
    }

    if (typeof role === "string") {
      user.role = role;
    }

    if (typeof email_verified === "boolean") {
      user.email_verified = email_verified;
    }

    if (typeof two_factor_enabled === "boolean") {
      if (two_factor_enabled && !user.two_factor_secret) {
        return res.status(400).json({
          success: false,
          message: "Two-factor secret is required before enabling 2FA",
        });
      }

      user.two_factor_enabled = two_factor_enabled;
    }

    if (typeof account_status === "string") {
      const allowed_statuses = new Set([
        "active",
        "inactive",
        "suspended",
        "banned",
      ]);
      if (!allowed_statuses.has(account_status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid account_status value",
        });
      }
      user.account_status = account_status;
      user.account_status_changed_at = new Date();
      user.account_status_changed_by = req.user?.user_id || null;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: build_public_user(user),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const delete_user_by_id = async (req, res) => {
  try {
    await RefreshToken.deleteMany({ user_id: req.params.id });
    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const request_magic_link = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email }).select(
      "+magic_link_token_hash +magic_link_expires",
    );

    if (!user) {
      await log_auth_event(req, {
        event_type: "user.magic_link.request",
        status: "warning",
        email,
        message: "Magic-link request for unknown email",
      });

      return res.status(200).json({
        success: true,
        message: "If the account exists, a magic link has been sent.",
      });
    }

    if (
      await reject_if_user_not_active(req, res, user, "user.magic_link.request")
    ) {
      return;
    }

    const magic_link = create_magic_link_token();
    user.magic_link_token_hash = magic_link.hash;
    user.magic_link_expires = magic_link.expiresAt;
    await user.save();

    const web_app_url = get_web_app_url();
    const magic_link_url = `${web_app_url}/login.html?magic_token=${encodeURIComponent(magic_link.token)}`;
    await sendMagicLinkEmail({
      to: user.email,
      name: user.full_name,
      magicLinkUrl: magic_link_url,
      expiresInMinutes: Math.floor(magic_link_lifetime_ms / 60000),
    });

    await log_auth_event(req, {
      event_type: "user.magic_link.request",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "Magic-link email sent",
    });

    return res.status(200).json({
      success: true,
      message: "If the account exists, a magic link has been sent.",
    });
  } catch (error) {
    await log_auth_event(req, {
      event_type: "user.magic_link.request",
      status: "failure",
      severity: "critical",
      email: req.body?.email || null,
      message: "Magic-link request failed",
      metadata: { error: error.message },
    });

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const verify_magic_link = async (req, res) => {
  try {
    const token = req.params.token || req.body.token || req.query.token;

    if (req.method === "GET" && token) {
      const web_app_url = get_web_app_url();
      const login_url = `${web_app_url}/login.html?magic_token=${encodeURIComponent(token)}`;
      return res.redirect(302, login_url);
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Magic-link token is required",
      });
    }

    const token_hash = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      magic_link_token_hash: token_hash,
      magic_link_expires: { $gt: new Date() },
    }).select(
      "+magic_link_token_hash +magic_link_expires +two_factor_secret +trusted_devices",
    );

    if (!user) {
      await log_auth_event(req, {
        event_type: "user.magic_link.verify",
        status: "failure",
        severity: "warning",
        message: "Invalid or expired magic-link token",
      });

      return res.status(401).json({
        success: false,
        message: "Magic-link token is invalid or expired",
      });
    }

    if (
      await reject_if_user_not_active(req, res, user, "user.magic_link.verify")
    ) {
      return;
    }

    user.magic_link_token_hash = null;
    user.magic_link_expires = null;
    user.last_login_at = new Date();
    await user.save();

    const { token: access_token, refresh_token } = await issue_auth_session(
      user,
      req,
    );

    await log_auth_event(req, {
      event_type: "user.magic_link.verify",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "Magic-link login successful",
    });

    await send_security_email_safe(user, {
      title: "New passwordless login",
      message:
        "A passwordless magic-link login was completed for your account.",
      req,
    });

    return res.status(200).json({
      success: true,
      message: "Magic-link login successful",
      data: build_public_user(user),
      token: access_token,
      refresh_token,
    });
  } catch (error) {
    await log_auth_event(req, {
      event_type: "user.magic_link.verify",
      status: "failure",
      severity: "critical",
      message: "Magic-link verification failed",
      metadata: { error: error.message },
    });

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const set_user_status_by_id = async (req, res) => {
  try {
    const { account_status } = req.body;
    const allowed_statuses = new Set([
      "active",
      "inactive",
      "suspended",
      "banned",
    ]);

    if (!allowed_statuses.has(account_status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid account_status value",
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const previous_status = user.account_status;
    user.account_status = account_status;
    user.account_status_changed_at = new Date();
    user.account_status_changed_by = req.user?.user_id || null;
    await user.save();

    if (previous_status !== account_status && account_status !== "active") {
      await RefreshToken.deleteMany({ user_id: user._id });
    }

    await log_auth_event(req, {
      event_type: "admin.user_status_changed",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "Admin updated user account status",
      metadata: {
        admin_user_id: req.user?.user_id || null,
        previous_status,
        new_status: account_status,
      },
    });

    await send_security_email_safe(user, {
      title: "Account status updated",
      message: `Your account status changed from ${previous_status} to ${account_status}.`,
      req,
      should_skip_when_unverified: false,
    });

    return res.status(200).json({
      success: true,
      message: "Account status updated successfully",
      data: build_public_user(user),
    });
  } catch (error) {
    await log_auth_event(req, {
      event_type: "admin.user_status_changed",
      status: "failure",
      severity: "critical",
      user_id: req.params?.id || null,
      message: "Failed to update account status",
      metadata: { error: error.message },
    });

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const deactivate_user_by_id = async (req, res) => {
  req.body.account_status = "inactive";
  return set_user_status_by_id(req, res);
};

export const reactivate_user_by_id = async (req, res) => {
  req.body.account_status = "active";
  return set_user_status_by_id(req, res);
};

export const list_auth_events = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const query = {};

    if (req.query.event_type) {
      query.event_type = req.query.event_type;
    }

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.email) {
      query.email = req.query.email;
    }

    const events = await AuthEvent.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(
        "event_type status severity message user_id email request_id ip_address user_agent metadata createdAt",
      );

    return res.status(200).json({
      success: true,
      count: events.length,
      data: events,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const auth_monitoring_summary = async (req, res) => {
  try {
    const since_hours = Math.min(Number(req.query.since_hours || 24), 24 * 30);
    const since = new Date(Date.now() - since_hours * 60 * 60 * 1000);

    const [status_summary, event_summary, critical_errors] = await Promise.all([
      AuthEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$status", total: { $sum: 1 } } },
      ]),
      AuthEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$event_type", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 15 },
      ]),
      AuthEvent.find({
        createdAt: { $gte: since },
        severity: "critical",
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("event_type message email request_id createdAt metadata"),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        since,
        status_summary,
        top_events: event_summary,
        critical_errors,
      },
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Refresh access token.
 */
export const refresh_access_token = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    const decoded = verify_token(refresh_token, process.env.JWT_REFRESH_SECRET);

    const stored_refresh_token = await RefreshToken.findOne({
      token: refresh_token,
      user_id: decoded.user_id,
    });

    if (!stored_refresh_token) {
      await log_auth_event(req, {
        event_type: "user.token_refresh",
        status: "failure",
        severity: "warning",
        message: "Refresh token was invalid or revoked",
      });
      return res.status(401).json({
        success: false,
        message: "Refresh token is invalid or revoked",
      });
    }

    const user = await User.findById(decoded.user_id);

    if (!user) {
      await RefreshToken.deleteOne({ _id: stored_refresh_token._id });
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (await reject_if_user_not_active(req, res, user, "user.token_refresh")) {
      await RefreshToken.deleteOne({ _id: stored_refresh_token._id });
      return;
    }

    await RefreshToken.deleteOne({ _id: stored_refresh_token._id });

    const { token, refresh_token: new_refresh_token } =
      await issue_auth_session(user, req);

    await log_auth_event(req, {
      event_type: "user.token_refresh",
      status: "success",
      user_id: user._id,
      email: user.email,
      message: "Access token refreshed",
    });

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      token,
      refresh_token: new_refresh_token,
    });
  } catch (error) {
    await log_auth_event(req, {
      event_type: "user.token_refresh",
      status: "failure",
      severity: "warning",
      message: "Refresh token verification failed",
      metadata: { error: error.message },
    });
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
};

/**
 * Logout and revoke refresh token.
 */
export const logout_user = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    await RefreshToken.deleteOne({ token: refresh_token });

    await log_auth_event(req, {
      event_type: "user.logout",
      status: "success",
      user_id: req.user?.user_id || null,
      email: req.user?.email || null,
      message: "User logged out",
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    await log_auth_event(req, {
      event_type: "user.logout",
      status: "failure",
      severity: "warning",
      user_id: req.user?.user_id || null,
      message: "Logout failed",
      metadata: { error: error.message },
    });
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
export const list_active_sessions = async (req, res) => {
  try {
    const sessions = await RefreshToken.find({
      user_id: req.user.user_id,
      revoked_at: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .select(
        "user_agent ip_address device_name createdAt expiresAt last_used_at",
      );

    return res.json({
      success: true,
      total: sessions.length,
      sessions: sessions.map((session) => ({
        session_id: session._id,
        user_agent: session.user_agent,
        ip_address: session.ip_address,
        device_name: session.device_name,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        last_used_at: session.last_used_at,
      })),
    });
    // eslint-disable-next-line no-unused-vars
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Error fetching sessions",
    });
  }
};
export const delete_active_session = async (req, res) => {
  try {
    const { id: session_id } = req.params;

    const deletedSession = await RefreshToken.findOneAndDelete({
      _id: session_id,
      user_id: req.user.user_id,
    });

    if (!deletedSession) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Session deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
