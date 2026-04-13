import express from "express";

import {
  create_product,
  delete_product,
  get_product_by_id,
  list_products,
  update_product,
} from "../controllers/product.controller.js";
import { admin_middleware } from "../middleware/admin.middleware.js";
import { auth_middleware } from "../middleware/auth.middleware.js";

const product_router = express.Router();

product_router.get("/", list_products);
product_router.get("/:id", get_product_by_id);

product_router.post("/", auth_middleware, admin_middleware, create_product);
product_router.patch("/:id", auth_middleware, admin_middleware, update_product);
product_router.delete(
  "/:id",
  auth_middleware,
  admin_middleware,
  delete_product,
);

export default product_router;
