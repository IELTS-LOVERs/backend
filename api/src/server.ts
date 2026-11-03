import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/database.js";
import { ensureBucket } from "./config/minio.js";
import { logger } from "./common/utils/logger.js";

async function bootstrap(): Promise<void> {
  await connectDB();

  try {
    await Promise.race([
      ensureBucket(env.MINIO_BUCKET),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("MinIO connection timed out (5s)")), 5000),
      ),
    ]);
  } catch (error) {
    logger.warn("minio.unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  app.listen(env.PORT, () => {
    logger.info("server.started", { url: `http://localhost:${env.PORT}` });
  });
}

bootstrap().catch((error) => {
  logger.error("server.start_failed", { error });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", { reason });
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error });
  process.exit(1);
});
