import type { Types } from "mongoose";
import { connectDB, disconnectDB } from "../config/database.js";
import { AttemptModel } from "../modules/attempts/attempt.model.js";
import {
  DEFAULT_BAND_CONVERSION,
  ExamModel,
  type IBandConversion,
  type IExam,
} from "../modules/exams/exam.model.js";
import { countExamQuestions } from "../modules/exams/exam.service.js";

type LeanExam = {
  _id: Types.ObjectId;
  kind?: "practice" | "mock";
  scoringMode?: "band" | "raw";
  bandConversion?: IBandConversion;
  sections?: IExam["sections"];
};

type LeanAttempt = {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  examKind?: "practice" | "mock";
  scoringMode?: "band" | "raw";
  bandConversionSnapshot?: IBandConversion;
  skills?: string[];
  questionCount?: number;
  totalPoints?: number;
  scores?: {
    listeningBand?: number;
    readingBand?: number;
    overallBand?: number;
  };
};

function countExamPoints(exam?: LeanExam): number {
  let points = 0;
  for (const section of exam?.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      for (const question of group.questions ?? []) {
        points += question.points ?? 1;
      }
    }
  }
  return points;
}

interface BackfillResult {
  examsChecked: number;
  examsUpdated: number;
  examsSkipped: number;
  attemptsChecked: number;
  attemptsUpdated: number;
  attemptsSkipped: number;
}

export async function runBackfill(dryRun: boolean): Promise<BackfillResult> {
  console.log(`[backfill-practice] Bắt đầu migration (dryRun=${dryRun})...`);

  // `.lean()` is critical here: Mongoose applies schema defaults when hydrating
  // documents, so a legacy document missing `kind` would otherwise look like
  // kind="mock" and the migration would incorrectly skip it.
  const exams = (await ExamModel.find({}).lean()) as unknown as LeanExam[];
  let examsUpdated = 0;
  let examsSkipped = 0;

  for (const exam of exams) {
    const effectiveKind = exam.kind ?? "mock";
    const needsKind = !exam.kind;
    const needsScoringMode =
      effectiveKind === "practice"
        ? exam.scoringMode !== "raw"
        : !exam.scoringMode;
    const needsBandConversion =
      effectiveKind === "mock" &&
      (exam.scoringMode ?? "band") === "band" &&
      !exam.bandConversion;
    const shouldClearBandConversion =
      (effectiveKind === "practice" ||
        (effectiveKind === "mock" && (exam.scoringMode ?? "band") === "raw")) &&
      exam.bandConversion !== undefined;

    if (
      needsKind ||
      needsScoringMode ||
      needsBandConversion ||
      shouldClearBandConversion
    ) {
      if (!dryRun) {
        await ExamModel.updateOne(
          { _id: exam._id },
          {
            $set: {
              ...(needsKind ? { kind: "mock" } : {}),
              ...(needsScoringMode
                ? { scoringMode: effectiveKind === "practice" ? "raw" : "band" }
                : {}),
              ...(needsBandConversion
                ? { bandConversion: DEFAULT_BAND_CONVERSION }
                : {}),
            },
            ...(shouldClearBandConversion
              ? { $unset: { bandConversion: 1 } }
              : {}),
          }
        );
      }
      examsUpdated += 1;
    } else {
      examsSkipped += 1;
    }
  }

  // 2. Backfill Attempts
  let attemptsChecked = 0;
  let attemptsUpdated = 0;
  let attemptsSkipped = 0;

  const examMap = new Map<string, LeanExam>();
  for (const exam of exams) {
    examMap.set(exam._id.toString(), exam);
  }

  // Cursor thay vì load toàn bộ attempts vào RAM.
  const attemptCursor = AttemptModel.find({}).lean().cursor();
  for await (const attempt of attemptCursor as AsyncIterable<LeanAttempt>) {
    attemptsChecked += 1;
    const needsExamKind = !attempt.examKind;
    const needsScoringMode = !attempt.scoringMode;
    const needsSkills =
      !attempt.skills || (Array.isArray(attempt.skills) && attempt.skills.length === 0);
    const needsQuestionCount =
      attempt.questionCount === undefined || attempt.questionCount === null;
    const needsTotalPoints =
      attempt.totalPoints === undefined || attempt.totalPoints === null;

    const exam = examMap.get(attempt.examId.toString());
    const examKind = (exam?.kind ?? "mock") as "practice" | "mock";
    const scoringMode =
      examKind === "practice"
        ? "raw"
        : exam?.scoringMode ?? "band";
    const needsScoringModeFix = attempt.scoringMode !== scoringMode;
    const needsBandSnapshot =
      examKind === "mock" &&
      scoringMode === "band" &&
      !attempt.bandConversionSnapshot;
    const hasPracticeBands =
      examKind === "practice" &&
      (attempt.scores?.listeningBand !== undefined ||
        attempt.scores?.readingBand !== undefined ||
        attempt.scores?.overallBand !== undefined);

    if (
      needsExamKind ||
      needsScoringMode ||
      needsScoringModeFix ||
      needsBandSnapshot ||
      hasPracticeBands ||
      needsSkills ||
      needsQuestionCount ||
      needsTotalPoints
    ) {
      const skills = exam
        ? [...new Set((exam.sections ?? []).map((s) => s.skill))]
        : [];
      const questionCount = exam
        ? countExamQuestions(exam as unknown as Pick<IExam, "sections">)
        : 0;
      const totalPoints = countExamPoints(exam);

      if (!dryRun) {
        await AttemptModel.updateOne(
          { _id: attempt._id },
          {
            $set: {
              ...(needsExamKind ? { examKind } : {}),
              ...(needsScoringMode || needsScoringModeFix ? { scoringMode } : {}),
              ...(needsBandSnapshot
                ? { bandConversionSnapshot: exam?.bandConversion ?? DEFAULT_BAND_CONVERSION }
                : {}),
              ...(needsSkills ? { skills } : {}),
              ...(needsQuestionCount ? { questionCount } : {}),
              ...(needsTotalPoints ? { totalPoints } : {}),
            },
            ...(examKind === "practice"
              ? {
                  $unset: {
                    "scores.listeningBand": 1,
                    "scores.readingBand": 1,
                    "scores.overallBand": 1,
                  },
                }
              : {}),
          }
        );
      }
      attemptsUpdated += 1;
    } else {
      attemptsSkipped += 1;
    }
  }

  console.log(`[backfill-practice] Hoàn thành backfill:`);
  console.log(`  - Exams: ${examsUpdated} cần cập nhật, ${examsSkipped} bỏ qua (tổng: ${exams.length})`);
  console.log(`  - Attempts: ${attemptsUpdated} cần cập nhật, ${attemptsSkipped} bỏ qua (tổng: ${attemptsChecked})`);

  return {
    examsChecked: exams.length,
    examsUpdated,
    examsSkipped,
    attemptsChecked,
    attemptsUpdated,
    attemptsSkipped,
  };
}

async function main(): Promise<void> {
  const isDryRun =
    process.argv.includes("--dry-run") ||
    process.argv.includes("--dryRun") ||
    process.env.npm_config_dry_run === "true";
  await connectDB();
  try {
    await runBackfill(isDryRun);
  } finally {
    await disconnectDB();
  }
}

import path from "path";
import { fileURLToPath } from "url";

// Only run main if called directly via CLI
const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  main().catch((error) => {
    console.error("[backfill-practice] Thất bại:", error);
    process.exit(1);
  });
}
