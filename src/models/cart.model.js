import mongoose from "mongoose";

const cart_schema = mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [
      {
        product_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],
  },
  { timestamps: true },
);

const Cart = mongoose.model("Cart", cart_schema, "carts");
export default Cart;
