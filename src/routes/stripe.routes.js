import express from "express";

import {
  create_payment_intent,
  create_refund,
} from "../controllers/stripe.controller.js";
import { admin_middleware } from "../middleware/admin.middleware.js";
import { auth_middleware } from "../middleware/auth.middleware.js";
import { require_idempotency_key } from "../utils/idempotency.util.js";

const router = express.Router();

router.post(
  "/payment-intents",
  auth_middleware,
  require_idempotency_key,
  create_payment_intent,
);

router.post(
  "/refunds/:payment_intent_id",
  auth_middleware,
  admin_middleware,
  require_idempotency_key,
  create_refund,
);

export default router;
