import express from "express";

import {
  get_my_cart_checkout_preview,
  get_my_order_by_id,
  get_my_orders,
  get_order_by_tracking_id,
  request_my_order_refund,
} from "../controllers/order.controller.js";
import { auth_middleware } from "../middleware/auth.middleware.js";

const order_router = express.Router();

order_router.get("/preview", auth_middleware, get_my_cart_checkout_preview);
order_router.get("/", auth_middleware, get_my_orders);
order_router.get(
  "/tracking/:tracking_id",
  auth_middleware,
  get_order_by_tracking_id,
);
order_router.post(
  "/:id/refund-request",
  auth_middleware,
  request_my_order_refund,
);
order_router.get("/:id", auth_middleware, get_my_order_by_id);

export default order_router;
