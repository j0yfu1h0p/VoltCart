import process from "node:process";

import { stripe } from "../configs/stripe.config.js";
import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import PaymentTransaction from "../models/payment-transaction.model.js";
import Product from "../models/product.model.js";
import StripeWebhookEvent from "../models/stripe-webhook-event.model.js";
import User from "../models/user.model.js";
import { write_ledger_entry } from "../services/ledger.service.js";
import {
  create_admin_notifications,
  create_user_notification,
} from "../services/notification.service.js";
import {
  get_idempotency_replay,
  save_idempotency_result,
} from "../utils/idempotency.util.js";
import {
  sendOrderBookedEmail,
  sendOrderStatusEmail,
} from "../utils/mail.util.js";
import { build_tracking_id, order_status_label } from "../utils/order.util.js";

const SUPPORTED_CURRENCIES = new Set(["usd", "eur", "gbp", "aed", "sar"]);
const SHIPPING_FLAT_AMOUNT = 1000;

const safe_send_order_email = async (handler) => {
  try {
    await handler();
  } catch {
    // Do not fail payment flow if SMTP is unavailable.
  }
};

const build_order_status_url = (tracking_id) => {
  const base_url = (process.env.APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base_url}/orders/tracking/${encodeURIComponent(tracking_id)}`;
};

const validate_shipping_details = (shipping) => {
  if (!shipping || typeof shipping !== "object") {
    return "shipping_details is required";
  }

  const required_fields = [
    "full_name",
    "email",
    "phone",
    "address_line_1",
    "city",
    "postal_code",
    "country",
  ];

  const missing = required_fields.filter(
    (field) => !shipping[field] || !String(shipping[field]).trim(),
  );

  if (missing.length > 0) {
    return `Missing shipping fields: ${missing.join(", ")}`;
  }

  return null;
};

const ensure_cart_with_stock = async (user_id) => {
  const cart = await Cart.findOne({ user: user_id }).populate(
    "items.product_id",
    "name price stock",
  );

  if (!cart || cart.items.length === 0) {
    const error = new Error("Cart is empty");
    error.status_code = 400;
    throw error;
  }

  const items = cart.items.map((item) => {
    const product = item.product_id;

    if (!product) {
      const error = new Error("One or more cart products no longer exist");
      error.status_code = 400;
      throw error;
    }

    return {
      product_id: product._id,
      name: product.name,
      unit_price: product.price,
      quantity: item.quantity,
      line_total: product.price * item.quantity,
    };
  });

  return { cart, items };
};

const reserve_stock_for_items = async (items) => {
  const reserved = [];

  try {
    for (const item of items) {
      const result = await Product.updateOne(
        { _id: item.product_id, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
      );

      if (!result.modifiedCount) {
        throw new Error(`Insufficient stock for ${item.name}`);
      }

      reserved.push(item);
    }
  } catch (error) {
    for (const item of reserved) {
      await Product.updateOne(
        { _id: item.product_id },
        { $inc: { stock: item.quantity } },
      );
    }
    throw error;
  }
};

const release_order_stock_if_reserved = async (order) => {
  if (!order.stock_reserved) {
    return;
  }

  for (const item of order.items) {
    await Product.updateOne(
      { _id: item.product_id },
      { $inc: { stock: item.quantity } },
    );
  }

  order.stock_reserved = false;
};

const find_or_create_pending_order = async ({
  user_id,
  items,
  currency,
  shipping_details,
}) => {
  const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
  const total = subtotal + SHIPPING_FLAT_AMOUNT;

  const existing = await Order.findOne({
    user: user_id,
    order_status: "pending",
    payment_status: {
      $in: ["requires_payment_method", "processing", "failed"],
    },
  }).sort({ createdAt: -1 });

  if (existing) {
    existing.items = items;
    existing.currency = currency;
    existing.subtotal_amount = subtotal;
    existing.shipping_amount = SHIPPING_FLAT_AMOUNT;
    existing.total_amount = total;
    existing.shipping_details = shipping_details;
    existing.payment_customer = {
      full_name: shipping_details.full_name,
      email: shipping_details.email,
      phone: shipping_details.phone,
      address: shipping_details.address_line_1,
      city: shipping_details.city,
      postal_code: shipping_details.postal_code,
      country: shipping_details.country,
    };
    existing.timeline.push({
      status: "pending",
      message: "Checkout retry: payment intent regenerated",
      metadata: {},
      created_at: new Date(),
    });

    await existing.save();
    return existing;
  }

  const order = await Order.create({
    user: user_id,
    tracking_id: build_tracking_id(),
    items,
    currency,
    subtotal_amount: subtotal,
    shipping_amount: SHIPPING_FLAT_AMOUNT,
    total_amount: total,
    stock_reserved: false,
    order_status: "pending",
    payment_status: "requires_payment_method",
    shipping_details,
    payment_customer: {
      full_name: shipping_details.full_name,
      email: shipping_details.email,
      phone: shipping_details.phone,
      address: shipping_details.address_line_1,
      city: shipping_details.city,
      postal_code: shipping_details.postal_code,
      country: shipping_details.country,
    },
    support_phone: process.env.SUPPORT_PHONE || "+1-000-000-0000",
    timeline: [
      {
        status: "pending",
        message: "Order created and awaiting payment",
        metadata: {},
        created_at: new Date(),
      },
    ],
  });

  return order;
};

export const create_payment_intent = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const currency = String(req.body.currency || "usd").toLowerCase();
    const shipping_details = req.body.shipping_details;
    const idempotency_key = req.idempotency_key;

    if (!SUPPORTED_CURRENCIES.has(currency)) {
      return res
        .status(400)
        .json({ success: false, message: "Unsupported currency" });
    }

    const shipping_error = validate_shipping_details(shipping_details);
    if (shipping_error) {
      return res.status(400).json({ success: false, message: shipping_error });
    }

    const request_payload = { currency, shipping_details };
    const replay = await get_idempotency_replay({
      key: idempotency_key,
      scope: "payments.create_intent",
      user_id,
      payload: request_payload,
    });

    if (replay.replay) {
      return res.status(replay.status_code).json(replay.response_body);
    }

    const { items } = await ensure_cart_with_stock(user_id);

    const order = await find_or_create_pending_order({
      user_id,
      items,
      currency,
      shipping_details,
    });

    if (!order.stock_reserved) {
      await reserve_stock_for_items(items);
      order.stock_reserved = true;
      order.timeline.push({
        status: "pending",
        message: "Stock reserved for checkout",
        metadata: {},
        created_at: new Date(),
      });
    }

    const payment_intent = await stripe.paymentIntents.create(
      {
        amount: order.total_amount,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: {
          order_id: String(order._id),
          tracking_id: order.tracking_id,
          user_id: String(user_id),
        },
      },
      {
        idempotencyKey: idempotency_key,
      },
    );

    order.payment_intent_id = payment_intent.id;
    order.payment_status = payment_intent.status;
    order.timeline.push({
      status: "pending",
      message: "Stripe payment intent created",
      metadata: { payment_intent_id: payment_intent.id },
      created_at: new Date(),
    });
    await order.save();

    await PaymentTransaction.findOneAndUpdate(
      { payment_intent_id: payment_intent.id },
      {
        $set: {
          order: order._id,
          user: user_id,
          payment_intent_id: payment_intent.id,
          amount: order.total_amount,
          currency,
          status: payment_intent.status,
          metadata: payment_intent.metadata || {},
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const order_user = await User.findById(user_id).select(
      "_id email full_name",
    );
    await write_ledger_entry({
      order,
      user: order_user,
      event_type: "payment_intent_created",
      amount: order.total_amount,
      currency,
      payment_status: payment_intent.status,
      transaction_id: payment_intent.id,
      metadata: { idempotency_key },
    });

    const response_body = {
      success: true,
      message: "Payment intent created",
      data: {
        order_id: order._id,
        tracking_id: order.tracking_id,
        payment_intent_id: payment_intent.id,
        client_secret: payment_intent.client_secret,
        publishable_key: process.env.STRIPE_PUBLIC_KEY || null,
        amount: payment_intent.amount,
        currency: payment_intent.currency,
        status: payment_intent.status,
      },
    };

    await save_idempotency_result({
      key: idempotency_key,
      scope: "payments.create_intent",
      user_id,
      request_hash: replay.request_hash,
      status_code: 201,
      response_body,
    });

    return res.status(201).json(response_body);
  } catch (error) {
    const status_code =
      error?.status_code ||
      (error?.type === "StripeInvalidRequestError" ? 400 : 500);

    return res.status(status_code).json({
      success: false,
      message: error?.message || "Unable to create payment intent",
    });
  }
};

export const stripe_webhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhook_secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature) {
    return res.status(400).json({
      success: false,
      message: "Missing Stripe signature header",
    });
  }

  if (!webhook_secret) {
    return res.status(500).json({
      success: false,
      message: "STRIPE_WEBHOOK_SECRET is missing",
    });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhook_secret);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: `Webhook signature verification failed: ${error.message}`,
    });
  }

  try {
    const existing = await StripeWebhookEvent.findOne({
      stripe_event_id: event.id,
    });
    if (existing) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    const payment_intent = event.data?.object;
    const payment_intent_id = payment_intent?.id;

    const attach_webhook_log = async ({
      processing_status,
      processing_error = null,
    }) => {
      await StripeWebhookEvent.create({
        stripe_event_id: event.id,
        event_type: event.type,
        livemode: Boolean(event.livemode),
        api_version: event.api_version || null,
        request_id: event.request?.id || null,
        idempotency_key: event.request?.idempotency_key || null,
        payload: event,
        processing_status,
        processing_error,
      });
    };

    const handle_payment_update = async ({
      payment_intent_ref,
      next_payment_status,
      next_order_status,
      event_type,
      timeline_message,
      release_reserved_stock = false,
      failure_message = null,
      charge_id = null,
      refund_id = null,
      billing_details = null,
    }) => {
      const order = await Order.findOne({
        payment_intent_id: payment_intent_ref,
      }).populate("user", "_id email full_name");

      if (!order) {
        await attach_webhook_log({
          processing_status: "ignored",
          processing_error: `No order found for payment_intent_id ${payment_intent_ref}`,
        });
        return;
      }

      order.payment_status = next_payment_status;
      order.order_status = next_order_status;
      order.transaction_id = payment_intent_ref;

      if (release_reserved_stock) {
        await release_order_stock_if_reserved(order);
      }

      if (event.type === "payment_intent.succeeded") {
        order.stock_reserved = false;
      }

      if (billing_details) {
        order.payment_customer = {
          full_name:
            billing_details.name ||
            order.payment_customer?.full_name ||
            order.shipping_details.full_name,
          email:
            billing_details.email ||
            order.payment_customer?.email ||
            order.shipping_details.email,
          phone:
            billing_details.phone ||
            order.payment_customer?.phone ||
            order.shipping_details.phone,
          address:
            billing_details.address?.line1 ||
            order.payment_customer?.address ||
            order.shipping_details.address_line_1,
          city:
            billing_details.address?.city ||
            order.payment_customer?.city ||
            order.shipping_details.city,
          postal_code:
            billing_details.address?.postal_code ||
            order.payment_customer?.postal_code ||
            order.shipping_details.postal_code,
          country:
            billing_details.address?.country ||
            order.payment_customer?.country ||
            order.shipping_details.country,
        };
      }

      order.timeline.push({
        status: next_order_status,
        message: timeline_message,
        metadata: { stripe_event_type: event.type },
        created_at: new Date(),
      });
      await order.save();

      await PaymentTransaction.findOneAndUpdate(
        { payment_intent_id: payment_intent_ref },
        {
          $set: {
            order: order._id,
            user: order.user._id,
            payment_intent_id: payment_intent_ref,
            amount: order.total_amount,
            currency: order.currency,
            status: next_payment_status,
            failure_message,
            stripe_charge_id: charge_id,
            stripe_refund_id: refund_id,
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      await write_ledger_entry({
        order,
        user: order.user,
        event_type,
        amount: order.total_amount,
        currency: order.currency,
        payment_status: next_payment_status,
        transaction_id: payment_intent_ref,
        metadata: {
          stripe_event_type: event.type,
          status_label: order_status_label(next_order_status),
          failure_message,
        },
      });

      if (event.type === "payment_intent.succeeded") {
        await Cart.findOneAndUpdate(
          { user: order.user._id },
          { $set: { items: [] } },
        );

        await create_user_notification({
          user_id: order.user._id,
          type: "order_booked",
          title: "Order booked",
          message: `Your order ${order.tracking_id} was booked successfully`,
          order_id: order._id,
        });

        await create_admin_notifications({
          type: "admin_alert",
          title: "New paid order",
          message: `Order ${order.tracking_id} is paid`,
          order_id: order._id,
          metadata: { payment_intent_id: payment_intent_ref },
        });

        if (order.user?.email) {
          await safe_send_order_email(async () => {
            await sendOrderBookedEmail({
              to: order.user.email,
              name: order.user.full_name,
              trackingId: order.tracking_id,
              total: order.total_amount,
              currency: order.currency,
              items: order.items,
              statusUrl: build_order_status_url(order.tracking_id),
            });
          });
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        await create_user_notification({
          user_id: order.user._id,
          type: "payment_failed",
          title: "Payment failed",
          message: `Payment failed for order ${order.tracking_id}. Please retry.`,
          order_id: order._id,
          metadata: { reason: failure_message },
        });
      }

      await attach_webhook_log({ processing_status: "processed" });
    };

    switch (event.type) {
      case "payment_intent.succeeded": {
        const billing_details =
          payment_intent?.charges?.data?.[0]?.billing_details || null;

        await handle_payment_update({
          payment_intent_ref: payment_intent_id,
          next_payment_status: "succeeded",
          next_order_status: "paid",
          event_type: "payment_succeeded",
          timeline_message: "Payment received successfully",
          billing_details,
        });
        break;
      }

      case "payment_intent.payment_failed": {
        await handle_payment_update({
          payment_intent_ref: payment_intent_id,
          next_payment_status: "failed",
          next_order_status: "pending",
          event_type: "payment_failed",
          timeline_message: "Payment failed. Please retry with another method",
          release_reserved_stock: true,
          failure_message: payment_intent?.last_payment_error?.message || null,
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const intent_id = charge.payment_intent;
        if (!intent_id) {
          await StripeWebhookEvent.create({
            stripe_event_id: event.id,
            event_type: event.type,
            livemode: Boolean(event.livemode),
            api_version: event.api_version || null,
            request_id: event.request?.id || null,
            idempotency_key: event.request?.idempotency_key || null,
            payload: event,
            processing_status: "ignored",
            processing_error: "Refund event missing payment_intent",
          });
          break;
        }

        await handle_payment_update({
          payment_intent_ref: intent_id,
          next_payment_status: "refunded",
          next_order_status: "cancelled",
          event_type: "payment_refunded",
          timeline_message: "Payment refunded",
          release_reserved_stock: true,
          charge_id: charge.id,
          refund_id: charge.refunds?.data?.[0]?.id || null,
          billing_details: charge.billing_details || null,
        });
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object;
        const charge_id = dispute.charge;
        const txn = await PaymentTransaction.findOne({
          stripe_charge_id: charge_id,
        });

        if (!txn) {
          await StripeWebhookEvent.create({
            stripe_event_id: event.id,
            event_type: event.type,
            livemode: Boolean(event.livemode),
            api_version: event.api_version || null,
            request_id: event.request?.id || null,
            idempotency_key: event.request?.idempotency_key || null,
            payload: event,
            processing_status: "ignored",
            processing_error: `No transaction found for charge ${charge_id}`,
          });
          break;
        }

        const order = await Order.findOne({
          payment_intent_id: txn.payment_intent_id,
        }).populate("user", "_id email full_name");

        if (!order) {
          await StripeWebhookEvent.create({
            stripe_event_id: event.id,
            event_type: event.type,
            livemode: Boolean(event.livemode),
            api_version: event.api_version || null,
            request_id: event.request?.id || null,
            idempotency_key: event.request?.idempotency_key || null,
            payload: event,
            processing_status: "ignored",
            processing_error: `No order found for transaction ${txn._id}`,
          });
          break;
        }

        order.payment_status = "disputed";
        order.issue_flag = {
          type: "contact_support",
          message: `Payment dispute opened. Please contact support at ${
            process.env.SUPPORT_PHONE || "+1-000-000-0000"
          }`,
          created_at: new Date(),
        };
        order.timeline.push({
          status: order.order_status,
          message: "Payment dispute opened",
          metadata: { dispute_id: dispute.id },
          created_at: new Date(),
        });
        await order.save();

        txn.status = "disputed";
        await txn.save();

        await write_ledger_entry({
          order,
          user: order.user,
          event_type: "payment_disputed",
          amount: order.total_amount,
          currency: order.currency,
          payment_status: "disputed",
          transaction_id: txn.payment_intent_id,
          metadata: { dispute_id: dispute.id, charge_id },
        });

        await create_user_notification({
          user_id: order.user._id,
          type: "payment_disputed",
          title: "Payment disputed",
          message: `A dispute was opened for order ${order.tracking_id}`,
          order_id: order._id,
          metadata: { dispute_id: dispute.id },
        });

        await create_admin_notifications({
          type: "admin_alert",
          title: "Payment dispute opened",
          message: `Dispute ${dispute.id} opened for order ${order.tracking_id}`,
          order_id: order._id,
          metadata: { dispute_id: dispute.id },
        });

        await StripeWebhookEvent.create({
          stripe_event_id: event.id,
          event_type: event.type,
          livemode: Boolean(event.livemode),
          api_version: event.api_version || null,
          request_id: event.request?.id || null,
          idempotency_key: event.request?.idempotency_key || null,
          payload: event,
          processing_status: "processed",
          processing_error: null,
        });
        break;
      }

      default:
        await StripeWebhookEvent.create({
          stripe_event_id: event.id,
          event_type: event.type,
          livemode: Boolean(event.livemode),
          api_version: event.api_version || null,
          request_id: event.request?.id || null,
          idempotency_key: event.request?.idempotency_key || null,
          payload: event,
          processing_status: "ignored",
          processing_error: "Unhandled event type",
        });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Webhook handling failed",
    });
  }
};

export const create_refund = async (req, res) => {
  try {
    const payment_intent_id = req.params.payment_intent_id;
    const idempotency_key = req.idempotency_key;

    if (!payment_intent_id) {
      return res.status(400).json({
        success: false,
        message: "payment_intent_id is required",
      });
    }

    const transaction = await PaymentTransaction.findOne({
      payment_intent_id,
    }).populate("order");

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    const request_payload = {
      payment_intent_id,
      amount: req.body?.amount || null,
    };

    const replay = await get_idempotency_replay({
      key: idempotency_key,
      scope: "payments.refund",
      user_id: req.user.user_id,
      payload: request_payload,
    });

    if (replay.replay) {
      return res.status(replay.status_code).json(replay.response_body);
    }

    const refund_amount = req.body?.amount
      ? Number(req.body.amount)
      : undefined;
    if (
      refund_amount !== undefined &&
      (!Number.isInteger(refund_amount) || refund_amount <= 0)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "amount must be a positive integer" });
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: payment_intent_id,
        ...(refund_amount ? { amount: refund_amount } : {}),
      },
      { idempotencyKey: idempotency_key },
    );

    const order = await Order.findById(transaction.order).populate(
      "user",
      "_id email full_name",
    );
    if (order) {
      await release_order_stock_if_reserved(order);
      order.payment_status = "refunded";
      order.order_status = "cancelled";
      order.timeline.push({
        status: "cancelled",
        message: "Refund initiated by admin",
        metadata: { refund_id: refund.id },
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
        metadata: { refund_id: refund.id, initiated_by: req.user.user_id },
      });

      await create_user_notification({
        user_id: order.user._id,
        type: "payment_refunded",
        title: "Payment refunded",
        message: `Refund initiated for order ${order.tracking_id}`,
        order_id: order._id,
        metadata: { refund_id: refund.id },
      });

      await create_admin_notifications({
        type: "admin_alert",
        title: "Refund initiated",
        message: `Refund initiated for order ${order.tracking_id}`,
        order_id: order._id,
        metadata: { refund_id: refund.id },
      });

      if (order.user?.email) {
        await safe_send_order_email(async () => {
          await sendOrderStatusEmail({
            to: order.user.email,
            name: order.user.full_name,
            trackingId: order.tracking_id,
            status: "Cancelled / Refunded",
            statusMessage: "Your order was refunded and marked cancelled.",
            statusUrl: build_order_status_url(order.tracking_id),
          });
        });
      }
    }

    transaction.status = "refunded";
    transaction.stripe_refund_id = refund.id;
    await transaction.save();

    const response_body = {
      success: true,
      message: "Refund initiated",
      data: {
        refund_id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        payment_intent_id,
        status: refund.status,
      },
    };

    await save_idempotency_result({
      key: idempotency_key,
      scope: "payments.refund",
      user_id: req.user.user_id,
      request_hash: replay.request_hash,
      status_code: 201,
      response_body,
    });

    return res.status(201).json(response_body);
  } catch (error) {
    const status = error?.type === "StripeInvalidRequestError" ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: error?.message || "Unable to create refund",
    });
  }
};
