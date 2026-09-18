import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/database.js";
import { ensureBucket } from "./config/minio.js";

async function bootstrap(): Promise<void> {
  await connectDB();
  await ensureBucket(env.MINIO_BUCKET);

  app.listen(env.PORT, env.HOST, () => {
    console.log(`[server] Server running on http://${env.HOST}:${env.PORT}`);
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
