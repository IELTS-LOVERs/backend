import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB(): Promise<void> {
  mongoose.set("debug", env.NODE_ENV === "development");

  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log("[database] Connected to MongoDB");
  } catch (error) {
    console.error("[database] MongoDB connection error:", error);
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
