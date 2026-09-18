import { z } from "zod";

const TaskGradeSchema = z.object({
  score: z.number().min(0).max(9),
  comment: z.string().optional(),
});

export const GradeWritingSchema = z.object({
  body: z.object({
    attemptId: z.string().min(1, "Thiếu ID bài làm"),
    task1: TaskGradeSchema,
    task2: TaskGradeSchema,
    generalFeedback: z.string().optional(),
  }),
});

export type GradeWritingBody = z.infer<typeof GradeWritingSchema>["body"];
export type TaskGradeBody = z.infer<typeof TaskGradeSchema>;
