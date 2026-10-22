import { z } from "zod";

export const CreateAssignmentSchema = z.object({
  body: z
    .object({
      examId: z.string().min(1, "Thiếu ID đề thi"),
      classId: z.string().min(1).optional(),
      studentId: z.string().min(1).optional(),
      deadline: z.iso.datetime().optional(),
      maxAttempts: z.coerce.number().int().min(1).max(10).optional().default(1),
      shuffleQuestions: z.boolean().optional().default(false),
      showScoreAfterSubmit: z.boolean().optional().default(true),
    })
    .refine((data) => Boolean(data.classId || data.studentId), {
      message: "Cần chọn giao cho lớp (classId) hoặc học sinh (studentId)",
    }),
});

export const UpdateAssignmentSchema = z.object({
  params: z.object({ id: z.string().min(1, "Thiếu ID bài tập") }),
  body: z
    .object({
      deadline: z.iso.datetime().optional(),
      status: z.enum(["active", "archived"]).optional(),
      maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
      shuffleQuestions: z.boolean().optional(),
      showScoreAfterSubmit: z.boolean().optional(),
    })
    .refine(
      (data) =>
        data.deadline !== undefined ||
        data.status !== undefined ||
        data.maxAttempts !== undefined ||
        data.shuffleQuestions !== undefined ||
        data.showScoreAfterSubmit !== undefined,
      {
        message: "Cần cung cấp ít nhất một trường để cập nhật",
      }
    ),
});

export type CreateAssignmentBody = z.infer<typeof CreateAssignmentSchema>["body"];
export type UpdateAssignmentBody = z.infer<typeof UpdateAssignmentSchema>["body"];

export const ListAssignmentsQuerySchema = z.object({
  query: z.object({
    classId: z.string().optional(),
    examId: z.string().optional(),
    kind: z.enum(["practice", "mock"]).optional(),
    type: z.enum(["practice", "exam", "mock"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>["query"];

// REQ-001: học sinh lọc bài tập của mình theo lớp, trạng thái nộp, và loại bài (luyện tập / đề thi).
export const MyAssignmentsQuerySchema = z.object({
  query: z.object({
    classId: z.string().min(1).optional(),
    status: z
      .enum(["all", "not_started", "in_progress", "submitted", "expired"])
      .optional(),
    kind: z.enum(["practice", "mock"]).optional(),
    type: z.enum(["practice", "exam", "mock"]).optional(),
  }),
});

export type MyAssignmentsQuery = z.infer<typeof MyAssignmentsQuerySchema>["query"];
