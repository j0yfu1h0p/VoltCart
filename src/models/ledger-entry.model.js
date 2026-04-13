import mongoose from "mongoose";

const ledger_entry_schema = new mongoose.Schema(
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
    tracking_id: { type: String, required: true, index: true },
    event_type: {
      type: String,
      enum: [
        "payment_intent_created",
        "payment_succeeded",
        "payment_failed",
        "payment_refunded",
        "payment_disputed",
        "order_status_changed",
        "issue_flagged",
      ],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "usd" },
    payment_status: { type: String, required: true },
    transaction_id: { type: String, default: null, index: true },
    user_email: { type: String, default: null },
    products: {
      type: [
        {
          product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
          name: { type: String, required: true },
          quantity: { type: Number, required: true },
          unit_price: { type: Number, required: true },
        },
      ],
      default: [],
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

const LedgerEntry = mongoose.model(
  "LedgerEntry",
  ledger_entry_schema,
  "ledger_entries",
);

export default LedgerEntry;
