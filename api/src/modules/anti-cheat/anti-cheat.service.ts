import mongoose from "mongoose";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import {
  ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD,
  ANTI_CHEAT_PASTE_THRESHOLD,
  ANTI_CHEAT_TAB_SWITCH_THRESHOLD,
} from "../../config/constants.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ExamEventModel } from "./exam-event.model.js";
import type { LogExamEventBody } from "./anti-cheat.validation.js";

export interface SuspiciousCounts {
  tabSwitchOrBlur: number;
  fullscreenExit: number;
  paste: number;
}

export interface AntiCheatThresholds {
  tabSwitch: number;
  fullscreenExit: number;
  paste: number;
}

export interface LogExamEventResult {
  recorded: boolean;
  suspiciousFlag: boolean;
}

export function evaluateSuspicious(
  counts: SuspiciousCounts,
  thresholds: AntiCheatThresholds
): boolean {
  return (
    counts.tabSwitchOrBlur >= thresholds.tabSwitch ||
    counts.fullscreenExit >= thresholds.fullscreenExit ||
    counts.paste >= thresholds.paste
  );
}

export async function logEvent(
  data: LogExamEventBody,
  studentId: string
): Promise<LogExamEventResult> {
  const attempt = await AttemptModel.findById(data.attemptId);

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  if (attempt.studentId.toString() !== studentId) {
    throw new ForbiddenError(
      "ATTEMPT_NOT_OWNED",
      "Học sinh không có quyền truy cập bài làm này."
    );
  }

  if (attempt.status === "submitted") {
    throw new BadRequestError("EXAM_ALREADY_SUBMITTED", "Bài thi đã được nộp trước đó.");
  }

  if (attempt.status === "expired") {
    throw new ForbiddenError(
      "EXAM_EXPIRED",
      "Thời gian làm bài thi đã kết thúc. Không thể ghi nhận sự kiện."
    );
  }

  await ExamEventModel.create({
    attemptId: attempt._id,
    studentId: new mongoose.Types.ObjectId(studentId),
    type: data.type,
    timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
    metadata: data.metadata ?? {},
  });

  // LIMITATION (MVP): the spec counts PASTE >= 3 "within the Writing section",
  // but ExamEvent does not store the skill. We therefore count PASTE globally
  // across the whole attempt.
  const [tabSwitchOrBlur, fullscreenExit, paste] = await Promise.all([
    ExamEventModel.countDocuments({
      attemptId: attempt._id,
      type: { $in: ["TAB_SWITCH", "WINDOW_BLUR"] },
    }),
    ExamEventModel.countDocuments({
      attemptId: attempt._id,
      type: "FULLSCREEN_EXIT",
    }),
    ExamEventModel.countDocuments({
      attemptId: attempt._id,
      type: "PASTE",
    }),
  ]);

  const suspiciousNow = evaluateSuspicious(
    { tabSwitchOrBlur, fullscreenExit, paste },
    {
      tabSwitch: ANTI_CHEAT_TAB_SWITCH_THRESHOLD,
      fullscreenExit: ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD,
      paste: ANTI_CHEAT_PASTE_THRESHOLD,
    }
  );

  if (suspiciousNow && !attempt.suspicious) {
    await AttemptModel.updateOne({ _id: attempt._id }, { $set: { suspicious: true } });
  }

  return {
    recorded: true,
    suspiciousFlag: attempt.suspicious || suspiciousNow,
  };
}
