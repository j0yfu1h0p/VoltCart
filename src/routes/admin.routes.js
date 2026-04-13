import express from "express";

import {
  admin_decide_order_refund,
  admin_list_ledger,
  admin_list_orders,
  admin_list_payments,
  admin_list_webhook_logs,
  admin_update_order_status,
} from "../controllers/admin.controller.js";
import { admin_middleware } from "../middleware/admin.middleware.js";
import { auth_middleware } from "../middleware/auth.middleware.js";
import { require_idempotency_key } from "../utils/idempotency.util.js";

const admin_router = express.Router();

admin_router.use(auth_middleware, admin_middleware);

admin_router.get("/orders", admin_list_orders);
admin_router.patch(
  "/orders/:id/status",
  require_idempotency_key,
  admin_update_order_status,
);
admin_router.post(
  "/orders/:id/refund-decision",
  require_idempotency_key,
  admin_decide_order_refund,
);
admin_router.get("/payments", admin_list_payments);
admin_router.get("/ledger", admin_list_ledger);
admin_router.get("/webhooks", admin_list_webhook_logs);

export default admin_router;
