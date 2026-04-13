import mongoose from "mongoose";

const notification_schema = new mongoose.Schema(
  {
    recipient_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    recipient_role: {
      type: String,
      enum: ["user", "admin"],
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "order_booked",
        "order_status_changed",
        "refund_requested",
        "payment_success",
        "payment_failed",
        "payment_refunded",
        "payment_disputed",
        "admin_alert",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    is_read: { type: Boolean, default: false, index: true },
    read_at: { type: Date, default: null },
  },
  { timestamps: true },
);

const Notification = mongoose.model(
  "Notification",
  notification_schema,
  "notifications",
);

export default Notification;
