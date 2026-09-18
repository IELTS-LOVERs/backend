import { z } from "zod";

export const StartAttemptSchema = z.object({
  body: z.object({
    examId: z.string().min(1, "Thiếu ID đề thi"),
    assignmentId: z.string().min(1).optional(),
  }),
});

export const AutosaveAnswersSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bài làm"),
  }),
  body: z.object({
    answers: z.array(
      z.object({
        questionId: z.string().min(1, "Thiếu ID câu hỏi"),
        value: z.string(),
      })
    ),
  }),
});

export const GetMyAttemptsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    status: z.enum(["in_progress", "submitted", "expired"]).optional(),
    examId: z.string().optional(),
  }),
});

export type StartAttemptBody = z.infer<typeof StartAttemptSchema>["body"];
export type AutosaveAnswersBody = z.infer<typeof AutosaveAnswersSchema>["body"];
export type AutosaveAnswersParams = z.infer<typeof AutosaveAnswersSchema>["params"];
export type GetMyAttemptsQuery = z.infer<typeof GetMyAttemptsSchema>["query"];

