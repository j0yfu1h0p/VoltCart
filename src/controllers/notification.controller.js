import Notification from "../models/notification.model.js";

export const list_my_notifications = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const rows = await Notification.find({ recipient_user: req.user.user_id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate(
        "order",
        "tracking_id order_status payment_status total_amount currency",
      );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const mark_notification_read = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient_user: req.user.user_id,
    });

    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    notification.is_read = true;
    notification.read_at = new Date();
    await notification.save();

    return res
      .status(200)
      .json({ success: true, message: "Notification marked read" });
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid notification id" });
  }
};
