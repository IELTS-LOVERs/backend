import { z } from "zod";

export const EXAM_EVENT_TYPES = [
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "FULLSCREEN_EXIT",
  "RELOAD",
  "COPY",
  "PASTE",
  "CUT",
  "CONTEXT_MENU",
  "INTERRUPTION",
] as const;

export const LogExamEventSchema = z.object({
  body: z.object({
    attemptId: z.string().min(1, "Thiếu ID bài làm"),
    type: z.enum(EXAM_EVENT_TYPES),
    timestamp: z.iso.datetime().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
});

export type LogExamEventBody = z.infer<typeof LogExamEventSchema>["body"];
export type ExamEventTypeInput = LogExamEventBody["type"];

export const SuspiciousReportSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export type SuspiciousReportQuery = z.infer<typeof SuspiciousReportSchema>["query"];
