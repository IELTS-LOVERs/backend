import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/database.js";
import { AttemptModel } from "../modules/attempts/attempt.model.js";

/**
 * FIX-07 migration.
 *
 * The schema used to declare two indexes with the same key `{studentId, examId}`:
 * a plain one (`studentId_1_examId_1`) and a unique partial one
 * (`unique_student_exam_in_progress`). MongoDB cannot create both, so the unique
 * index was silently never created and `startAttempt`'s 11000 race guard was dead
 * code. This script:
 *   1. Finds any duplicate `in_progress` attempts per {studentId, examId} and
 *      keeps the newest, marking the rest `expired`.
 *   2. Drops the legacy non-unique index.
 *   3. syncIndexes() to (re)create the unique partial index.
 *
 * Run once per environment: `npm run fix-attempt-indexes`.
 * On a brand-new database you can skip this — `syncIndexes` at boot creates it.
 */
const LEGACY_INDEX_NAME = "studentId_1_examId_1";

interface DuplicateGroup {
  _id: { studentId: mongoose.Types.ObjectId; examId: mongoose.Types.ObjectId };
  ids: mongoose.Types.ObjectId[];
  count: number;
}

async function expireDuplicateInProgress(): Promise<number> {
  const groups = await AttemptModel.aggregate<DuplicateGroup>([
    { $match: { status: "in_progress" } },
    {
      $group: {
        _id: { studentId: "$studentId", examId: "$examId" },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let expiredCount = 0;

  for (const group of groups) {
    const docs = await AttemptModel.find({ _id: { $in: group.ids } }).sort({
      startedAt: -1,
      _id: -1,
    });

    // Keep the newest, expire the rest.
    const [, ...duplicates] = docs;

    for (const duplicate of duplicates) {
      await AttemptModel.updateOne(
        { _id: duplicate._id },
        { $set: { status: "expired", submittedAt: duplicate.expiresAt } }
      );
      expiredCount += 1;
      console.log(
        `[fix-indexes] attempt ${duplicate._id.toString()} (student ${String(
          group._id.studentId
        )}, exam ${String(group._id.examId)}) → expired`
      );
    }
  }

  return expiredCount;
}

async function main(): Promise<void> {
  await connectDB();

  try {
    console.log("[fix-indexes] Đang dò attempt in_progress trùng {studentId, examId}…");
    const expiredCount = await expireDuplicateInProgress();
    console.log(`[fix-indexes] Đã chuyển ${expiredCount} attempt trùng sang 'expired'.`);

    const collection = AttemptModel.collection;
    const existing = await collection.indexes().catch(() => []);

    if (existing.some((index) => index.name === LEGACY_INDEX_NAME)) {
      await collection.dropIndex(LEGACY_INDEX_NAME);
      console.log(`[fix-indexes] Đã xoá index cũ "${LEGACY_INDEX_NAME}".`);
    } else {
      console.log(`[fix-indexes] Không tìm thấy index cũ "${LEGACY_INDEX_NAME}" (bỏ qua).`);
    }

    await AttemptModel.syncIndexes();
    console.log("[fix-indexes] syncIndexes() hoàn tất.");

    const finalIndexes = await collection.indexes();
    console.log(
      `[fix-indexes] Index hiện tại: ${finalIndexes
        .map((index) => index.name)
        .filter(Boolean)
        .join(", ")}`
    );
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error("[fix-indexes] Thất bại:", error);
  process.exit(1);
});
