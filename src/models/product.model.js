import mongoose from "mongoose";

const product_schema = mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    image_url: { type: String, default: "" },
  },
  { timestamps: true },
);

const Product = mongoose.model("Product", product_schema, "products");
export default Product;
