import process from "node:process";

import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import {
  create_admin_notifications,
  create_user_notification,
} from "../services/notification.service.js";
import { order_status_label } from "../utils/order.util.js";

const get_refund_request_meta = (order) => {
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  const request_entry = [...timeline]
    .reverse()
    .find((timeline_entry) => timeline_entry?.metadata?.refund_requested);

  if (!request_entry) {
    return {
      refund_requested: false,
      refund_requested_at: null,
      refund_status: "none",
      refund_resolution_at: null,
    };
  }

  const request_time = new Date(request_entry.created_at || 0).getTime();
  const resolution_entry = [...timeline].reverse().find((timeline_entry) => {
    const resolution = timeline_entry?.metadata?.refund_resolution;
    const created = new Date(timeline_entry?.created_at || 0).getTime();
    return (
      (resolution === "approved" || resolution === "rejected") &&
      created >= request_time
    );
  });

  const refund_resolution =
    resolution_entry?.metadata?.refund_resolution || null;

  return {
    refund_requested: refund_resolution !== "rejected",
    refund_requested_at: request_entry.created_at || null,
    refund_status:
      refund_resolution === "approved"
        ? "approved"
        : refund_resolution === "rejected"
          ? "rejected"
          : "requested",
    refund_resolution_at: resolution_entry?.created_at || null,
  };
};

const format_order = (order) => {
  const refund_meta = get_refund_request_meta(order);

  return {
    id: order._id,
    tracking_id: order.tracking_id,
    order_status: order.order_status,
    order_status_label: order_status_label(order.order_status),
    payment_status: order.payment_status,
    payment_intent_id: order.payment_intent_id,
    transaction_id: order.transaction_id,
    items: order.items,
    amount: {
      subtotal: order.subtotal_amount,
      shipping: order.shipping_amount,
      total: order.total_amount,
      currency: order.currency,
    },
    shipping_details: order.shipping_details,
    issue_flag: order.issue_flag,
    timeline: order.timeline,
    refund_requested: refund_meta.refund_requested,
    refund_requested_at: refund_meta.refund_requested_at,
    refund_status: refund_meta.refund_status,
    refund_resolution_at: refund_meta.refund_resolution_at,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
};

export const get_my_orders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.user_id }).sort({
      createdAt: -1,
    });
    return res
      .status(200)
      .json({ success: true, data: orders.map(format_order) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const get_my_order_by_id = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user.user_id,
    });

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    return res.status(200).json({ success: true, data: format_order(order) });
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid order id" });
  }
};

export const get_order_by_tracking_id = async (req, res) => {
  try {
    const order = await Order.findOne({
      tracking_id: req.params.tracking_id,
      user: req.user.user_id,
    });

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    return res.status(200).json({ success: true, data: format_order(order) });
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid tracking id" });
  }
};

export const get_my_cart_checkout_preview = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.user_id }).populate(
      "items.product_id",
      "name price stock",
    );

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const items = cart.items.map((item) => {
      const product = item.product_id;
      return {
        product_id: product?._id,
        name: product?.name || "Unknown product",
        quantity: item.quantity,
        unit_price: product?.price || 0,
        stock: product?.stock || 0,
      };
    });

    const subtotal = items.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );

    return res.status(200).json({
      success: true,
      data: {
        items,
        subtotal_amount: subtotal,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const request_my_order_refund = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || "").trim();

    const order = await Order.findOne({
      _id: id,
      user: req.user.user_id,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (["refunded", "disputed"].includes(order.payment_status)) {
      return res.status(400).json({
        success: false,
        message: "Refund cannot be requested for this payment status",
      });
    }

    if (order.payment_status !== "succeeded") {
      return res.status(400).json({
        success: false,
        message: "Refund request is allowed only for paid orders",
      });
    }

    if (["delivered", "done", "cancelled"].includes(order.order_status)) {
      return res.status(400).json({
        success: false,
        message: "Refund request is not available after delivery is completed",
      });
    }

    const refund_meta = get_refund_request_meta(order);
    if (
      ["requested", "approved", "rejected"].includes(refund_meta.refund_status)
    ) {
      return res.status(409).json({
        success: false,
        message:
          refund_meta.refund_status === "rejected"
            ? "Refund request was already rejected for this order"
            : "Refund already requested for this order",
      });
    }

    const support_message =
      reason ||
      `Customer requested refund. Contact support at ${
        process.env.SUPPORT_PHONE || "+1-000-000-0000"
      }`;

    order.issue_flag = {
      type: "contact_support",
      message: support_message,
      created_at: new Date(),
    };

    order.timeline.push({
      status: "refund_requested",
      message: "Customer requested a refund",
      metadata: {
        refund_requested: true,
        reason: reason || null,
      },
      created_at: new Date(),
    });

    await order.save();

    await create_user_notification({
      user_id: req.user.user_id,
      type: "refund_requested",
      title: "Refund request submitted",
      message: `Your refund request for order ${order.tracking_id} has been submitted.`,
      order_id: order._id,
      metadata: { reason: reason || null },
    });

    await create_admin_notifications({
      type: "admin_alert",
      title: "Refund requested by customer",
      message: `Refund requested for order ${order.tracking_id}`,
      order_id: order._id,
      metadata: {
        user_id: req.user.user_id,
        reason: reason || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Refund request submitted",
      data: format_order(order),
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Invalid refund request",
    });
  }
};
