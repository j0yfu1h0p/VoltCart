import express from "express";

import {
  auth_monitoring_summary,
  change_password,
  deactivate_user_by_id,
  delete_account,
  delete_active_session,
  delete_all_sessions,
  delete_session,
  delete_user_by_id,
  disable_two_factor,
  enable_two_factor,
  get_current_user,
  get_user_by_id,
  list_active_sessions,
  list_auth_events,
  list_sessions,
  list_users,
  logout_user,
  reactivate_user_by_id,
  refresh_access_token,
  register_user,
  request_magic_link,
  request_password_reset,
  resend_verification_email,
  reset_password,
  set_user_status_by_id,
  show_reset_password_form,
  update_profile,
  update_user_by_id,
  user_login,
  verify_email,
  verify_magic_link,
  verify_two_factor,
} from "../controllers/auth.controller.js";
import { admin_middleware } from "../middleware/admin.middleware.js";
import { auth_middleware } from "../middleware/auth.middleware.js";
import { accountLockLoginRateLimiter } from "../middleware/rate-limit-middleware/account.lock.login.rate.limiter.js";
import {
  emailActionRateLimiter,
  refreshTokenRateLimiter,
  registerRateLimiter,
  tokenVerificationRateLimiter,
} from "../middleware/rate-limit-middleware/auth.endpoint.rate.limiter.js";

const router = express.Router();

// Body: full_name, email, password
router.post("/register", registerRateLimiter, register_user);
// Body: email, password
router.post("/login", accountLockLoginRateLimiter, user_login);
// Body: refresh_token
router.post("/refresh-token", refreshTokenRateLimiter, refresh_access_token);
// Body: refresh_token
router.post("/logout", logout_user);
// Header: Authorization: Bearer <access_token>
router.get("/me", auth_middleware, get_current_user);
// Header: Authorization: Bearer <access_token>; Body: full_name?, email?
router.patch("/me", auth_middleware, update_profile);
// Header: Authorization: Bearer <access_token>; Body: current_password, new_password, confirm_password
router.patch("/me/password", auth_middleware, change_password);
// Header: Authorization: Bearer <access_token>
router.delete("/me", auth_middleware, delete_account);

// Legacy aliases
// Header: Authorization: Bearer <access_token>; Body: full_name?, email?
router.patch("/update-profile", auth_middleware, update_profile);
// Header: Authorization: Bearer <access_token>; Body: current_password, new_password, confirm_password
router.patch("/change-password", auth_middleware, change_password);
// Legacy clients may send POST instead of PATCH
router.post("/change-password", auth_middleware, change_password);
// Header: Authorization: Bearer <access_token>
router.delete("/delete-account", auth_middleware, delete_account);

// Body: token
router.post("/email/verify", tokenVerificationRateLimiter, verify_email);
// GET link for email clicks
router.get("/verify-email/:token", tokenVerificationRateLimiter, verify_email);
// Header: Authorization: Bearer <access_token>
router.post("/email/verify/resend", auth_middleware, resend_verification_email);

// Legacy aliases
// Body: token
router.post("/verify-email", tokenVerificationRateLimiter, verify_email);
// Header: Authorization: Bearer <access_token>
router.post(
  "/resend-verification-email",
  auth_middleware,
  resend_verification_email,
);
// Header: Authorization: Bearer <access_token>
router.get("/sessions", auth_middleware, list_sessions);

// Header: Authorization: Bearer <access_token>
router.delete("/sessions/:id", auth_middleware, delete_session);

// Header: Authorization: Bearer <access_token>
router.delete("/sessions", auth_middleware, delete_all_sessions);

// Header: Authorization: Bearer <access_token>
router.post("/2fa/enable", auth_middleware, enable_two_factor);

// Header: Authorization: Bearer <access_token>; Body: code
router.post("/2fa/verify", auth_middleware, verify_two_factor);

// Header: Authorization: Bearer <access_token>; Body: current_password, code
router.post("/2fa/disable", auth_middleware, disable_two_factor);

// Body: email
router.post("/forgot-password", emailActionRateLimiter, request_password_reset);
router.get(
  "/reset-password/:token",
  tokenVerificationRateLimiter,
  show_reset_password_form,
);
router.post(
  "/reset-password/:token",
  tokenVerificationRateLimiter,
  reset_password,
);

// Header: Authorization: Bearer <access_token>
router.get("/users", auth_middleware, admin_middleware, list_users);

// Header: Authorization: Bearer <access_token>
router.get("/users/:id", auth_middleware, admin_middleware, get_user_by_id);

// Header: Authorization: Bearer <access_token>; Body: full_name?, email?, role?, email_verified?, two_factor_enabled?
router.patch(
  "/users/:id",
  auth_middleware,
  admin_middleware,
  update_user_by_id,
);

// Header: Authorization: Bearer <access_token>; Body: account_status
router.patch(
  "/users/:id/status",
  auth_middleware,
  admin_middleware,
  set_user_status_by_id,
);

router.patch(
  "/users/:id/deactivate",
  auth_middleware,
  admin_middleware,
  deactivate_user_by_id,
);

router.patch(
  "/users/:id/reactivate",
  auth_middleware,
  admin_middleware,
  reactivate_user_by_id,
);

// Header: Authorization: Bearer <access_token>
router.delete(
  "/users/:id",
  auth_middleware,
  admin_middleware,
  delete_user_by_id,
);

router.get(
  "/admin/events",
  auth_middleware,
  admin_middleware,
  list_auth_events,
);

router.get(
  "/admin/monitoring/summary",
  auth_middleware,
  admin_middleware,
  auth_monitoring_summary,
);

router.get("/active-sessions", auth_middleware, list_active_sessions);
router.delete("/revoke-session/:id", auth_middleware, delete_active_session);

// Body: email
router.post("/magic-link/request", emailActionRateLimiter, request_magic_link);
// Body: token
router.post(
  "/magic-link/verify",
  tokenVerificationRateLimiter,
  verify_magic_link,
);
router.get(
  "/magic-link/verify/:token",
  tokenVerificationRateLimiter,
  verify_magic_link,
);
export default router;
