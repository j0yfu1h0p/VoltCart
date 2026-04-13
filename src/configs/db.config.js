import mongoose from "mongoose";

async function connectDB() {
  try {
    // eslint-disable-next-line no-undef
    const uri = process.env.MONGO_URI;
    await mongoose.connect(uri);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    // eslint-disable-next-line no-undef
    process.exit(1);
  }
}

export default connectDB;
