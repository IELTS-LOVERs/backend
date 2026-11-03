import mongoose from "mongoose";
import { logger } from "../common/utils/logger.js";
import { env } from "./env.js";

export async function connectDB(): Promise<void> {
  mongoose.set("debug", env.NODE_ENV === "development");

  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info("database.connected");
  } catch (error) {
    logger.error("database.connection_failed", { error });
    throw error;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
