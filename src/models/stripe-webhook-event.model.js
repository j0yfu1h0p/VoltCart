import mongoose from "mongoose";

const stripe_webhook_event_schema = new mongoose.Schema(
  {
    stripe_event_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    event_type: { type: String, required: true, index: true },
    livemode: { type: Boolean, default: false },
    api_version: { type: String, default: null },
    request_id: { type: String, default: null },
    idempotency_key: { type: String, default: null, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    processing_status: {
      type: String,
      enum: ["processed", "ignored", "failed"],
      default: "processed",
    },
    processing_error: { type: String, default: null },
  },
  { timestamps: true },
);

const StripeWebhookEvent = mongoose.model(
  "StripeWebhookEvent",
  stripe_webhook_event_schema,
  "stripe_webhook_events",
);

export default StripeWebhookEvent;
