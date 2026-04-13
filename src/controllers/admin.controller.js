import process from "node:process";

import { stripe } from "../configs/stripe.config.js";
import LedgerEntry from "../models/ledger-entry.model.js";
import Order from "../models/order.model.js";
import PaymentTransaction from "../models/payment-transaction.model.js";
import Product from "../models/product.model.js";
import StripeWebhookEvent from "../models/stripe-webhook-event.model.js";
import { write_ledger_entry } from "../services/ledger.service.js";
import {
  create_admin_notifications,
  create_user_notification,
} from "../services/notification.service.js";
import { sendOrderStatusEmail } from "../utils/mail.util.js";
import { order_status_label } from "../utils/order.util.js";

const allowed_statuses = new Set([
  "pending",
  "paid",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "dispatched",
]);

const allowed_issue_flags = new Set([
  "none",
  "out_of_stock",
  "dispatched_issue",
  "contact_support",
]);

const get_latest_refund_request = (order) => {
  return [...(order.timeline || [])]
    .reverse()
    .find((entry) => entry?.metadata?.refund_requested);
};

const has_refund_resolution_after_request = (order, request_entry) => {
  if (!request_entry) {
    return false;
  }

  const request_time = new Date(request_entry.created_at || 0).getTime();
  return [...(order.timeline || [])].some((entry) => {
    const resolution = entry?.metadata?.refund_resolution;
    const created = new Date(entry?.created_at || 0).getTime();
    return (
      (resolution === "approved" || resolution === "rejected") &&
      created >= request_time
    );
  });
};

const release_reserved_stock = async (order) => {
  if (!order?.stock_reserved) {
    return;
  }

  for (const item of order.items || []) {
    await Product.updateOne(
      { _id: item.product_id },
      { $inc: { stock: item.quantity } },
    );
  }

  order.stock_reserved = false;
};

const build_tracking_url = (tracking_id) => {
  const base_url = (process.env.APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base_url}/orders/tracking/${encodeURIComponent(tracking_id)}`;
};

export const admin_list_orders = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const status = req.query.status;

    const query = {};
    if (status && allowed_statuses.has(status)) {
      query.order_status = status;
    }

    const orders = await Order.find(query)
      .populate("user", "full_name email")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const admin_update_order_status = async (req, res) => {
  try {
    const { status, issue_type = "none", issue_message = "" } = req.body;

    if (!allowed_statuses.has(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    if (!allowed_issue_flags.has(issue_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid issue_type",
      });
    }

    const order = await Order.findById(req.params.id).populate(
      "user",
      "email full_name",
    );

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (status === "cancelled" && order.stock_reserved) {
      for (const item of order.items) {
        await Product.updateOne(
          { _id: item.product_id },
          { $inc: { stock: item.quantity } },
        );
      }
      order.stock_reserved = false;
    }

    order.order_status = status;

    if (issue_type !== "none") {
      order.issue_flag = {
        type: issue_type,
        message:
          issue_message ||
          `Issue flagged (${issue_type}). Please contact support at ${
            process.env.SUPPORT_PHONE || "+1-000-000-0000"
          }`,
        created_at: new Date(),
      };
    }

    order.timeline.push({
      status,
      message: `Order marked as ${order_status_label(status)} by admin`,
      metadata: {
        admin_user_id: req.user.user_id,
        issue_type,
      },
      created_at: new Date(),
    });

    await order.save();

    await write_ledger_entry({
      order,
      user: order.user,
      event_type:
        issue_type === "none" ? "order_status_changed" : "issue_flagged",
      amount: order.total_amount,
      currency: order.currency,
      payment_status: order.payment_status,
      transaction_id: order.transaction_id,
      metadata: {
        status,
        issue_type,
        issue_message: order.issue_flag.message,
      },
    });

    await create_user_notification({
      user_id: order.user._id,
      type: "order_status_changed",
      title: "Order status updated",
      message: `Order ${order.tracking_id} status changed to ${order_status_label(status)}`,
      order_id: order._id,
      metadata: { status, issue_type },
    });

    await create_admin_notifications({
      type: "admin_alert",
      title: "Order status changed",
      message: `Order ${order.tracking_id} changed to ${order_status_label(status)}`,
      order_id: order._id,
      metadata: { status, issue_type },
    });

    try {
      if (order.user?.email) {
        const base_url = (
          process.env.APP_URL || "http://localhost:3000"
        ).replace(/\/$/, "");
        const status_url = `${base_url}/orders/tracking/${encodeURIComponent(order.tracking_id)}`;

        await sendOrderStatusEmail({
          to: order.user.email,
          name: order.user.full_name,
          trackingId: order.tracking_id,
          status: order_status_label(status),
          statusMessage:
            issue_type !== "none"
              ? order.issue_flag.message
              : `Your order is now ${order_status_label(status)}.`,
          statusUrl: status_url,
        });
      }
    } catch {
      // Email send failures should not fail status updates.
    }

    return res.status(200).json({
      success: true,
      message: "Order updated",
      data: order,
    });
  } catch {
    return res.status(400).json({ success: false, message: "Invalid request" });
  }
};

export const admin_decide_order_refund = async (req, res) => {
  try {
    const decision = String(req.body?.decision || "")
      .trim()
      .toLowerCase();
    const note = String(req.body?.note || "").trim();

    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "decision must be approve or reject",
      });
    }

    const order = await Order.findById(req.params.id).populate(
      "user",
      "_id email full_name",
    );

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const request_entry = get_latest_refund_request(order);
    if (!request_entry) {
      return res.status(400).json({
        success: false,
        message: "No refund request found for this order",
      });
    }

    if (has_refund_resolution_after_request(order, request_entry)) {
      return res.status(409).json({
        success: false,
        message: "Refund request already reviewed",
      });
    }

    if (decision === "reject") {
      order.issue_flag = {
        type: "none",
        message: "",
        created_at: null,
      };

      order.timeline.push({
        status: "refund_rejected",
        message: "Refund request rejected by admin",
        metadata: {
          refund_resolution: "rejected",
          admin_user_id: req.user.user_id,
          note: note || null,
        },
        created_at: new Date(),
      });

      await order.save();

      await create_user_notification({
        user_id: order.user._id,
        type: "order_status_changed",
        title: "Refund request rejected",
        message: `Your refund request for order ${order.tracking_id} was rejected.`,
        order_id: order._id,
        metadata: { decision: "rejected", note: note || null },
      });

      await create_admin_notifications({
        type: "admin_alert",
        title: "Refund request rejected",
        message: `Refund rejected for order ${order.tracking_id}`,
        order_id: order._id,
        metadata: { decision: "rejected", note: note || null },
      });

      try {
        if (order.user?.email) {
          await sendOrderStatusEmail({
            to: order.user.email,
            name: order.user.full_name,
            trackingId: order.tracking_id,
            status: "Refund request rejected",
            statusMessage:
              note ||
              "Your refund request was reviewed and rejected by support.",
            statusUrl: build_tracking_url(order.tracking_id),
          });
        }
      } catch {
        // Email failure should not block request resolution.
      }

      return res.status(200).json({
        success: true,
        message: "Refund request rejected",
        data: order,
      });
    }

    if (order.payment_status === "refunded") {
      return res.status(400).json({
        success: false,
        message: "Payment is already refunded",
      });
    }

    const transaction = await PaymentTransaction.findOne({ order: order._id });
    const payment_intent_id =
      order.payment_intent_id || transaction?.payment_intent_id || null;

    if (!payment_intent_id) {
      return res.status(400).json({
        success: false,
        message: "Payment intent not found for this order",
      });
    }

    const refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
    });

    await release_reserved_stock(order);
    order.payment_status = "refunded";
    order.order_status = "cancelled";
    order.issue_flag = {
      type: "none",
      message: "",
      created_at: null,
    };
    order.timeline.push({
      status: "cancelled",
      message: "Refund approved and processed by admin",
      metadata: {
        refund_resolution: "approved",
        refund_id: refund.id,
        admin_user_id: req.user.user_id,
        note: note || null,
      },
      created_at: new Date(),
    });
    await order.save();

    await write_ledger_entry({
      order,
      user: order.user,
      event_type: "payment_refunded",
      amount: refund.amount,
      currency: refund.currency,
      payment_status: "refunded",
      transaction_id: payment_intent_id,
      metadata: {
        refund_id: refund.id,
        initiated_by: req.user.user_id,
        decision: "approved",
      },
    });

    if (transaction) {
      transaction.status = "refunded";
      transaction.stripe_refund_id = refund.id;
      await transaction.save();
    }

    await create_user_notification({
      user_id: order.user._id,
      type: "payment_refunded",
      title: "Refund approved",
      message: `Refund approved for order ${order.tracking_id}`,
      order_id: order._id,
      metadata: { refund_id: refund.id, note: note || null },
    });

    await create_admin_notifications({
      type: "admin_alert",
      title: "Refund approved",
      message: `Refund approved for order ${order.tracking_id}`,
      order_id: order._id,
      metadata: { refund_id: refund.id, note: note || null },
    });

    try {
      if (order.user?.email) {
        await sendOrderStatusEmail({
          to: order.user.email,
          name: order.user.full_name,
          trackingId: order.tracking_id,
          status: "Cancelled / Refunded",
          statusMessage: "Your refund was approved and completed.",
          statusUrl: build_tracking_url(order.tracking_id),
        });
      }
    } catch {
      // Email failure should not block request resolution.
    }

    return res.status(200).json({
      success: true,
      message: "Refund approved and processed",
      data: {
        order_id: order._id,
        tracking_id: order.tracking_id,
        refund_id: refund.id,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error?.message || "Unable to process refund decision",
    });
  }
};

export const admin_list_payments = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const rows = await PaymentTransaction.find({})
      .populate("user", "full_name email")
      .populate("order", "tracking_id order_status")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const admin_list_ledger = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const rows = await LedgerEntry.find({})
      .populate("user", "full_name email")
      .populate("order", "tracking_id order_status payment_status")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const admin_list_webhook_logs = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const rows = await StripeWebhookEvent.find({})
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
