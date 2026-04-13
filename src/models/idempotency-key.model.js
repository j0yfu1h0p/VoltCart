import mongoose from "mongoose";

const idempotency_key_schema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    scope: { type: String, required: true },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
      index: true,
    },
    request_hash: { type: String, required: true },
    status_code: { type: Number, required: true, default: 200 },
    response_body: { type: mongoose.Schema.Types.Mixed, required: true },
    expires_at: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

idempotency_key_schema.index(
  { key: 1, scope: 1, user_id: 1 },
  { unique: true },
);
idempotency_key_schema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const IdempotencyKey = mongoose.model(
  "IdempotencyKey",
  idempotency_key_schema,
  "idempotency_keys",
);

export default IdempotencyKey;
