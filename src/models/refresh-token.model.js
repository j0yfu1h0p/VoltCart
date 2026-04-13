import mongoose from "mongoose";

const refresh_token_schema = mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    last_used_at: { type: Date, default: Date.now },
    user_agent: { type: String, default: null },
    ip_address: { type: String, default: null },
    device_name: { type: String, default: null },
    revoked_at: { type: Date, default: null },
  },
  { versionKey: false },
);

refresh_token_schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model(
  "RefreshToken",
  refresh_token_schema,
  "refresh_tokens",
);

export default RefreshToken;
