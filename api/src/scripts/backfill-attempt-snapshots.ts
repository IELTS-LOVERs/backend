import path from "path";
import { fileURLToPath } from "url";
import type { Types } from "mongoose";
import { connectDB, disconnectDB } from "../config/database.js";
import { AttemptModel } from "../modules/attempts/attempt.model.js";
import {
  buildResultDetails,
  type RawExamObject,
} from "../modules/attempts/attempt.service.js";
import { ExamModel } from "../modules/exams/exam.model.js";

interface LeanAttempt {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  status: string;
  answers?: Array<{ questionId: Types.ObjectId; value?: string }>;
  resultDetails?: unknown[];
}

interface LeanExam {
  _id: Types.ObjectId;
  title?: string;
  sections?: RawExamObject["sections"];
}

export interface BackfillSnapshotsResult {
  attemptsChecked: number;
  attemptsUpdated: number;
  attemptsSkipped: number;
  attemptsWithoutExam: number;
}

/**
 * Freeze `resultDetails` for attempts submitted before snapshots existed.
 *
 * Must run once *before* teachers start editing published exams, otherwise a
 * legacy result will keep following the live exam content. Idempotent: attempts
 * that already have a snapshot are skipped.
 */
export async function runBackfillSnapshots(
  dryRun: boolean
): Promise<BackfillSnapshotsResult> {
  console.log(`[backfill-attempt-snapshots] Bắt đầu (dryRun=${dryRun})...`);

  const examCache = new Map<string, LeanExam | null>();
  const cursor = AttemptModel.find({
    status: { $in: ["submitted", "expired"] },
  })
    .lean()
    .cursor();

  let attemptsChecked = 0;
  let attemptsUpdated = 0;
  let attemptsSkipped = 0;
  let attemptsWithoutExam = 0;

  for await (const raw of cursor as AsyncIterable<LeanAttempt>) {
    attemptsChecked += 1;

    if (Array.isArray(raw.resultDetails) && raw.resultDetails.length > 0) {
      attemptsSkipped += 1;
      continue;
    }

    const examKey = raw.examId.toString();
    if (!examCache.has(examKey)) {
      const exam = (await ExamModel.findById(raw.examId).lean()) as unknown as
        | LeanExam
        | null;
      examCache.set(examKey, exam);
    }
    const exam = examCache.get(examKey);

    if (!exam) {
      attemptsWithoutExam += 1;
      attemptsSkipped += 1;
      continue;
    }

    const answers = (raw.answers ?? []).map((answer) => ({
      questionId: answer.questionId,
      value: answer.value ?? "",
    }));

    const snapshot = buildResultDetails(
      exam as unknown as RawExamObject,
      answers
    );

    if (!dryRun) {
      await AttemptModel.updateOne(
        { _id: raw._id },
        {
          $set: {
            resultDetails: snapshot.details,
            questionCount: snapshot.questionCount,
            totalPoints: snapshot.totalPoints,
          },
        }
      );
    }

    attemptsUpdated += 1;
  }

  console.log("[backfill-attempt-snapshots] Hoàn thành:");
  console.log(
    `  - Attempts: ${attemptsUpdated} cập nhật, ${attemptsSkipped} bỏ qua (tổng: ${attemptsChecked})`
  );
  if (attemptsWithoutExam > 0) {
    console.log(`  - Thiếu đề (đã xoá?): ${attemptsWithoutExam}`);
  }

  return {
    attemptsChecked,
    attemptsUpdated,
    attemptsSkipped,
    attemptsWithoutExam,
  };
}

async function main(): Promise<void> {
  const isDryRun =
    process.argv.includes("--dry-run") ||
    process.argv.includes("--dryRun") ||
    process.env.npm_config_dry_run === "true";

  await connectDB();
  try {
    await runBackfillSnapshots(isDryRun);
  } finally {
    await disconnectDB();
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  main().catch((error) => {
    console.error("[backfill-attempt-snapshots] Thất bại:", error);
    process.exit(1);
  });
}
