import { env } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/database.js";
import { minioClient } from "../config/minio.js";
import { MediaModel } from "../modules/media/media.model.js";

const PENDING_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  await connectDB();

  try {
    const cutoff = new Date(Date.now() - PENDING_MEDIA_TTL_MS);
    const staleMedia = await MediaModel.find({
      status: "pending",
      createdAt: { $lt: cutoff },
    });

    let removed = 0;

    for (const media of staleMedia) {
      try {
        await minioClient.removeObject(env.MINIO_BUCKET, media.key);
      } catch {
        // MinIO object might already be gone
      }

      await MediaModel.deleteOne({ _id: media._id });
      removed += 1;
    }

    console.log(`[cleanup-media] Đã dọn ${removed}/${staleMedia.length} media pending quá 24h.`);
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error("[cleanup-media] Thất bại:", error);
  process.exit(1);
});
