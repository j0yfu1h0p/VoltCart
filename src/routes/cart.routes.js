import express from "express";

import {
  add_cart_item,
  clear_cart,
  get_full_cart_list,
  remove_cart_item,
  update_cart_item_quantity,
} from "../controllers/cart.controller.js";
import { auth_middleware } from "../middleware/auth.middleware.js";

const cart_router = express.Router();
cart_router.get("/cart", auth_middleware, get_full_cart_list);
cart_router.post("/cart/items", auth_middleware, add_cart_item);
cart_router.patch(
  "/cart/items/:product_id",
  auth_middleware,
  update_cart_item_quantity,
);
cart_router.delete(
  "/cart/items/:product_id",
  auth_middleware,
  remove_cart_item,
);
cart_router.delete("/cart", auth_middleware, clear_cart);

export default cart_router;

// Header
