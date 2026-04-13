import express from "express";

import {
  list_my_notifications,
  mark_notification_read,
} from "../controllers/notification.controller.js";
import { auth_middleware } from "../middleware/auth.middleware.js";

const notification_router = express.Router();

notification_router.get("/", auth_middleware, list_my_notifications);
notification_router.patch("/:id/read", auth_middleware, mark_notification_read);

export default notification_router;
