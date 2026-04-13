import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";

export const get_full_cart_list = async (req, res) => {
  const { user_id } = req.user;
  try {
    const cart = await Cart.findOne({ user: user_id }).populate(
      "items.product_id",
      "name price stock",
    );

    if (!cart) {
      return res.status(200).json({
        success: true,
        data: { user: user_id, items: [] },
      });
    }

    return res.status(200).json({ success: true, data: cart });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const add_cart_item = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { product_id, quantity = 1 } = req.body;

    if (!product_id) {
      return res.status(400).json({
        success: false,
        message: "product_id is required",
      });
    }

    const parsed_quantity = Number(quantity);
    if (!Number.isInteger(parsed_quantity) || parsed_quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a positive integer",
      });
    }

    const product = await Product.findById(product_id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    if (product.stock < parsed_quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} units available`,
      });
    }

    let cart = await Cart.findOne({ user: user_id });
    if (!cart) {
      cart = await Cart.create({ user: user_id, items: [] });
    }

    const existing_item = cart.items.find(
      (item) => item.product_id.toString() === product_id,
    );

    if (existing_item) {
      const new_quantity = existing_item.quantity + parsed_quantity;
      if (new_quantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} units available`,
        });
      }

      existing_item.quantity = new_quantity;
    } else {
      cart.items.push({ product_id, quantity: parsed_quantity });
    }

    await cart.save();
    const hydrated = await cart.populate(
      "items.product_id",
      "name price stock",
    );

    return res.status(200).json({
      success: true,
      message: "Item added to cart",
      data: hydrated,
    });
  } catch {
    return res.status(400).json({
      success: false,
      message: "Invalid payload",
    });
  }
};

export const update_cart_item_quantity = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { quantity } = req.body;
    const { product_id } = req.params;

    const parsed_quantity = Number(quantity);
    if (!Number.isInteger(parsed_quantity) || parsed_quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a positive integer",
      });
    }

    const product = await Product.findById(product_id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    if (parsed_quantity > product.stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} units available`,
      });
    }

    const cart = await Cart.findOne({ user: user_id });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    const existing_item = cart.items.find(
      (item) => item.product_id.toString() === product_id,
    );

    if (!existing_item) {
      return res
        .status(404)
        .json({ success: false, message: "Item not found in cart" });
    }

    existing_item.quantity = parsed_quantity;
    await cart.save();

    const hydrated = await cart.populate(
      "items.product_id",
      "name price stock",
    );
    return res
      .status(200)
      .json({ success: true, message: "Cart updated", data: hydrated });
  } catch {
    return res.status(400).json({ success: false, message: "Invalid request" });
  }
};

export const remove_cart_item = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { product_id } = req.params;

    const cart = await Cart.findOne({ user: user_id });
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    cart.items = cart.items.filter(
      (item) => item.product_id.toString() !== product_id,
    );

    await cart.save();
    const hydrated = await cart.populate(
      "items.product_id",
      "name price stock",
    );

    return res
      .status(200)
      .json({ success: true, message: "Item removed", data: hydrated });
  } catch {
    return res.status(400).json({ success: false, message: "Invalid request" });
  }
};

export const clear_cart = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const cart = await Cart.findOne({ user: user_id });
    if (!cart) {
      return res
        .status(200)
        .json({ success: true, message: "Cart already empty" });
    }

    cart.items = [];
    await cart.save();
    return res.status(200).json({ success: true, message: "Cart cleared" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
