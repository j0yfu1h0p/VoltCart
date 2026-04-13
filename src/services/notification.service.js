import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";

export const create_user_notification = async ({
  user_id,
  type,
  title,
  message,
  order_id = null,
  metadata = {},
}) => {
  return Notification.create({
    recipient_user: user_id,
    recipient_role: "user",
    type,
    title,
    message,
    order: order_id,
    metadata,
  });
};

export const create_admin_notifications = async ({
  type,
  title,
  message,
  order_id = null,
  metadata = {},
}) => {
  const admins = await User.find({
    role: "admin",
    account_status: "active",
  }).select("_id");

  if (!admins.length) {
    return [];
  }

  const payload = admins.map((admin) => ({
    recipient_user: admin._id,
    recipient_role: "admin",
    type,
    title,
    message,
    order: order_id,
    metadata,
  }));

  return Notification.insertMany(payload);
};
