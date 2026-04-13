import mongoose from "mongoose";

const user_schema = mongoose.Schema(
  {
    full_name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    account_status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      required: true,
      default: "active",
    },
    account_type: {
      type: String,
      enum: ["basic", "premium"],
      required: true,
      default: "basic",
    },
    account_status_changed_at: { type: Date, default: null },
    account_status_changed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    email_verified: { type: Boolean, default: false },
    email_verification_token: { type: String, default: null, select: false },
    email_verification_expires: { type: Date, default: null, select: false },

    two_factor_enabled: { type: Boolean, default: false },
    two_factor_secret: { type: String, default: null, select: false },

    password_reset_token: { type: String, default: null, select: false },
    password_reset_expires: { type: Date, default: null, select: false },

    magic_link_token_hash: { type: String, default: null, select: false },
    magic_link_expires: { type: Date, default: null, select: false },
    magic_link_login_required: { type: Boolean, default: false },
    last_login_at: { type: Date, default: null },

    trusted_devices: [
      {
        token: { type: String, required: true },
        user_agent: { type: String, required: true },
        ip: { type: String, required: true },
        created_at: { type: Date, default: Date.now },
        expires_at: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true },
);

const User = mongoose.model("User", user_schema, "dbase");
export default User;
