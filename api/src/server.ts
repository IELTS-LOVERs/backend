import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/database.js";
import { ensureBucket } from "./config/minio.js";

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
    console.warn(
      "[minio] ⚠ Could not connect to MinIO — file uploads will be unavailable.",
      error instanceof Error ? error.message : error,
    );
  }

  app.listen(env.PORT, () => {
    console.log(`[server] Server running on http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] Failed to start:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("[server] Uncaught exception:", error);
  process.exit(1);
});
