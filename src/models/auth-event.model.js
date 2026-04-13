import mongoose from "mongoose";

const auth_event_schema = mongoose.Schema(
  {
    event_type: { type: String, required: true },
    status: {
      type: String,
      enum: ["success", "failure", "warning"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
      index: true,
    },
    message: { type: String, required: true },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    email: { type: String, default: null, index: true },
    request_id: { type: String, default: null, index: true },
    ip_address: { type: String, default: null },
    user_agent: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

auth_event_schema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);
auth_event_schema.index({ event_type: 1, createdAt: -1 });

const AuthEvent = mongoose.model("AuthEvent", auth_event_schema, "auth_events");

export default AuthEvent;
