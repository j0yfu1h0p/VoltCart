import crypto from "node:crypto";

export const build_tracking_id = () => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random_part = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TRK-${stamp}-${random_part}`;
};

export const order_status_label = (status) => {
  const labels = {
    pending: "Pending",
    paid: "Paid",
    processing: "Processing",
    shipped: "Shipped",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered",
    cancelled: "Cancelled",
    dispatched: "Dispatched",
  };

  return labels[status] || status;
};
