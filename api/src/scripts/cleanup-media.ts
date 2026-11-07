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
    })
      .select("_id key")
      .lean();

    if (staleMedia.length === 0) {
      console.log("[cleanup-media] Không có media pending cần dọn.");
      return;
    }

    const keys = staleMedia.map((m) => m.key);
    const orphanIds = staleMedia.map((m) => m._id);

    try {
      await minioClient.removeObjects(env.MINIO_BUCKET, keys);
    } catch (err) {
      console.warn("[cleanup-media] Cảnh báo khi dọn MinIO objects theo batch:", err);
    }

    const deleteResult = await MediaModel.deleteMany({ _id: { $in: orphanIds } });
    console.log(
      `[cleanup-media] Đã dọn ${deleteResult.deletedCount}/${staleMedia.length} media pending quá 24h.`
    );
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error("[cleanup-media] Thất bại:", error);
  process.exit(1);
});
