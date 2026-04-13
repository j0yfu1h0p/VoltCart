import mongoose from "mongoose";

const payment_transaction_schema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    payment_intent_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    stripe_charge_id: { type: String, default: null, index: true },
    stripe_refund_id: { type: String, default: null, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "usd" },
    status: {
      type: String,
      enum: [
        "requires_payment_method",
        "processing",
        "succeeded",
        "failed",
        "refunded",
        "disputed",
      ],
      default: "requires_payment_method",
      index: true,
    },
    failure_message: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const PaymentTransaction = mongoose.model(
  "PaymentTransaction",
  payment_transaction_schema,
  "payment_transactions",
);

export default PaymentTransaction;
