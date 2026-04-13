import mongoose from "mongoose";

const order_item_schema = new mongoose.Schema(
  {
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: { type: String, required: true },
    unit_price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    line_total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const timeline_entry_schema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    message: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    created_at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const order_schema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tracking_id: { type: String, required: true, unique: true, index: true },
    items: { type: [order_item_schema], required: true, default: [] },
    currency: { type: String, required: true, default: "usd" },
    subtotal_amount: { type: Number, required: true, min: 0 },
    shipping_amount: { type: Number, required: true, min: 0, default: 0 },
    total_amount: { type: Number, required: true, min: 0 },
    stock_reserved: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    order_status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "dispatched",
      ],
      default: "pending",
      index: true,
    },
    payment_status: {
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
    payment_intent_id: { type: String, default: null, index: true },
    transaction_id: { type: String, default: null },
    shipping_details: {
      full_name: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      address_line_1: { type: String, required: true },
      address_line_2: { type: String, default: "" },
      city: { type: String, required: true },
      state: { type: String, default: "" },
      postal_code: { type: String, required: true },
      country: { type: String, required: true },
    },
    payment_customer: {
      full_name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      postal_code: { type: String, default: "" },
      country: { type: String, default: "" },
    },
    support_phone: { type: String, default: null },
    issue_flag: {
      type: {
        type: String,
        enum: ["none", "out_of_stock", "dispatched_issue", "contact_support"],
        default: "none",
      },
      message: { type: String, default: "" },
      created_at: { type: Date, default: null },
    },
    timeline: { type: [timeline_entry_schema], default: [] },
  },
  { timestamps: true },
);

const Order = mongoose.model("Order", order_schema, "orders");
export default Order;
