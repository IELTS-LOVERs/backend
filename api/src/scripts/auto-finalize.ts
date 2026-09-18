import { EXAM_GRACE_PERIOD_SECONDS } from "../config/constants.js";
import { connectDB, disconnectDB } from "../config/database.js";
import { AttemptModel } from "../modules/attempts/attempt.model.js";
import { finalizeAttempt } from "../modules/attempts/attempt.service.js";

async function main(): Promise<void> {
  await connectDB();

  try {
    const cutoff = new Date(Date.now() - EXAM_GRACE_PERIOD_SECONDS * 1000);
    const attempts = await AttemptModel.find({
      status: "in_progress",
      expiresAt: { $lt: cutoff },
    });

    let finalized = 0;

    for (const attempt of attempts) {
      try {
        await finalizeAttempt(
          attempt,
          attempt.expiresAt,
          "Bài thi đã được tự động nộp do hết thời gian làm bài.",
          "expired"
        );
        finalized += 1;
      } catch (error) {
        console.error(
          `[auto-finalize] Không thể chốt attempt ${attempt._id.toString()}:`,
          error
        );
      }
    }

    console.log(`[auto-finalize] Đã chốt ${finalized}/${attempts.length} bài làm hết giờ.`);
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error("[auto-finalize] Thất bại:", error);
  process.exit(1);
});
