import LedgerEntry from "../models/ledger-entry.model.js";

export const write_ledger_entry = async ({
  order,
  user,
  event_type,
  amount,
  currency,
  payment_status,
  transaction_id,
  metadata = {},
}) => {
  return LedgerEntry.create({
    order: order._id,
    user: user._id,
    tracking_id: order.tracking_id,
    event_type,
    amount,
    currency,
    payment_status,
    transaction_id: transaction_id || null,
    user_email: user.email,
    products: order.items.map((item) => ({
      product_id: item.product_id,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })),
    metadata,
  });
};
