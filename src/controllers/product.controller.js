import Product from "../models/product.model.js";

const to_int = (value) => Number.parseInt(value, 10);

export const list_products = async (req, res) => {
  try {
    const limit = Math.min(Math.max(to_int(req.query.limit) || 20, 1), 100);
    const page = Math.max(to_int(req.query.page) || 1, 1);

    const query = {};
    if (req.query.search) {
      query.name = { $regex: req.query.search, $options: "i" };
    }

    const [items, total] = await Promise.all([
      Product.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Product.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const get_product_by_id = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({ success: true, data: product });
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid product id" });
  }
};

export const create_product = async (req, res) => {
  try {
    const { name, description, price, stock, image_url } = req.body;

    if (!name || !description) {
      return res.status(400).json({
        success: false,
        message: "name and description are required",
      });
    }

    const parsed_price = Number(price);
    const parsed_stock = Number(stock);

    if (!Number.isFinite(parsed_price) || parsed_price < 0) {
      return res
        .status(400)
        .json({ success: false, message: "price must be >= 0" });
    }

    if (!Number.isInteger(parsed_stock) || parsed_stock < 0) {
      return res
        .status(400)
        .json({ success: false, message: "stock must be an integer >= 0" });
    }

    const product = await Product.create({
      name: String(name).trim(),
      description: String(description).trim(),
      price: parsed_price,
      stock: parsed_stock,
      image_url: image_url ? String(image_url).trim() : "",
    });

    return res
      .status(201)
      .json({ success: true, message: "Product created", data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const update_product = async (req, res) => {
  try {
    const updates = {};

    if (req.body.name !== undefined) {
      updates.name = String(req.body.name).trim();
    }

    if (req.body.description !== undefined) {
      updates.description = String(req.body.description).trim();
    }

    if (req.body.price !== undefined) {
      const parsed_price = Number(req.body.price);
      if (!Number.isFinite(parsed_price) || parsed_price < 0) {
        return res
          .status(400)
          .json({ success: false, message: "price must be >= 0" });
      }
      updates.price = parsed_price;
    }

    if (req.body.stock !== undefined) {
      const parsed_stock = Number(req.body.stock);
      if (!Number.isInteger(parsed_stock) || parsed_stock < 0) {
        return res
          .status(400)
          .json({ success: false, message: "stock must be an integer >= 0" });
      }
      updates.stock = parsed_stock;
    }

    if (req.body.image_url !== undefined) {
      updates.image_url = req.body.image_url
        ? String(req.body.image_url).trim()
        : "";
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Product updated", data: product });
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid product id or payload" });
  }
};

export const delete_product = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({ success: true, message: "Product deleted" });
  } catch {
    return res
      .status(400)
      .json({ success: false, message: "Invalid product id" });
  }
};
