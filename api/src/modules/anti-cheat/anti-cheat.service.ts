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
import {
  assertTeacherOwnsAttempt,
  canTeacherGradeAttempt,
} from "../grading/grading.service.js";
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

export interface ExamEventSummary {
  totalEvents: number;
  tabSwitchOrBlur: number;
  fullscreenExit: number;
  paste: number;
  copy: number;
  cut: number;
  reload: number;
  contextMenu: number;
  interruption: number;
  suspicious: boolean;
}

export interface ExamEventItem {
  id: string;
  type: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface AttemptEventsResult {
  attemptId: string;
  suspicious: boolean;
  summary: ExamEventSummary;
  events: ExamEventItem[];
}

export function summarizeEvents(
  events: { type: string }[],
  isSuspicious: boolean
): ExamEventSummary {
  let tabSwitchOrBlur = 0;
  let fullscreenExit = 0;
  let paste = 0;
  let copy = 0;
  let cut = 0;
  let reload = 0;
  let contextMenu = 0;
  let interruption = 0;

  for (const event of events) {
    switch (event.type) {
      case "TAB_SWITCH":
      case "WINDOW_BLUR":
        tabSwitchOrBlur += 1;
        break;
      case "FULLSCREEN_EXIT":
        fullscreenExit += 1;
        break;
      case "PASTE":
        paste += 1;
        break;
      case "COPY":
        copy += 1;
        break;
      case "CUT":
        cut += 1;
        break;
      case "RELOAD":
        reload += 1;
        break;
      case "CONTEXT_MENU":
        contextMenu += 1;
        break;
      case "INTERRUPTION":
        interruption += 1;
        break;
    }
  }

  return {
    totalEvents: events.length,
    tabSwitchOrBlur,
    fullscreenExit,
    paste,
    copy,
    cut,
    reload,
    contextMenu,
    interruption,
    suspicious: isSuspicious,
  };
}

export async function getAttemptEvents(
  attemptId: string,
  user: { id: string; role: string }
): Promise<AttemptEventsResult> {
  const attempt = await AttemptModel.findById(attemptId)
    .populate("examId", "createdBy")
    .populate("assignmentId", "teacherId");

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  if (user.role === "student") {
    if (attempt.studentId.toString() !== user.id) {
      throw new ForbiddenError(
        "ATTEMPT_NOT_OWNED",
        "Bạn không có quyền truy cập sự kiện của bài thi này."
      );
    }
  } else {
    assertTeacherOwnsAttempt(attempt, user.id, user.role);
  }

  const rawEvents = await ExamEventModel.find({ attemptId: attempt._id }).sort({
    timestamp: 1,
  });

  const summary = summarizeEvents(rawEvents, attempt.suspicious);

  const events: ExamEventItem[] = rawEvents.map((e) => ({
    id: e._id.toString(),
    type: e.type,
    timestamp: e.timestamp,
    metadata: e.metadata as Record<string, unknown> | undefined,
  }));

  return {
    attemptId: attempt._id.toString(),
    suspicious: attempt.suspicious,
    summary,
    events,
  };
}

export interface SuspiciousAttemptReport {
  attemptId: string;
  studentName: string;
  examTitle: string;
  submittedAt: Date | null;
  totalEvents: number;
  eventsByType: Record<string, number>;
}

export interface SuspiciousReportResult {
  items: SuspiciousAttemptReport[];
  total: number;
}

export async function getSuspiciousAttempts(
  userId: string,
  role: string,
  limit: number
): Promise<SuspiciousReportResult> {
  const attempts = await AttemptModel.find({ suspicious: true })
    .populate("examId", "title createdBy")
    .populate("studentId", "fullName email")
    .populate("assignmentId", "teacherId")
    .sort({ updatedAt: -1 })
    .limit(limit);

  const visible = attempts.filter((attempt) =>
    canTeacherGradeAttempt(attempt, userId, role)
  );

  const attemptIds = visible.map((attempt) => attempt._id);

  const eventCounts =
    attemptIds.length > 0
      ? await ExamEventModel.aggregate<{
          _id: { attemptId: mongoose.Types.ObjectId; type: string };
          count: number;
        }>([
          { $match: { attemptId: { $in: attemptIds } } },
          {
            $group: {
              _id: { attemptId: "$attemptId", type: "$type" },
              count: { $sum: 1 },
            },
          },
        ])
      : [];

  const countsByAttempt = new Map<string, Record<string, number>>();

  for (const row of eventCounts) {
    const key = row._id.attemptId.toString();
    const bucket = countsByAttempt.get(key) ?? {};
    bucket[row._id.type] = row.count;
    countsByAttempt.set(key, bucket);
  }

  const items: SuspiciousAttemptReport[] = visible
    .map((attempt) => {
      const exam = attempt.examId as unknown as { title?: string } | null;
      const student = attempt.studentId as unknown as {
        fullName?: string;
        email?: string;
      } | null;
      const eventsByType = countsByAttempt.get(attempt._id.toString()) ?? {};
      const totalEvents = Object.values(eventsByType).reduce(
        (acc, value) => acc + value,
        0
      );

      return {
        attemptId: attempt._id.toString(),
        studentName: student?.fullName ?? student?.email ?? "",
        examTitle: exam?.title ?? "",
        submittedAt: attempt.submittedAt ?? null,
        totalEvents,
        eventsByType,
      };
    })
    .sort((a, b) => b.totalEvents - a.totalEvents);

  return { items, total: items.length };
}

