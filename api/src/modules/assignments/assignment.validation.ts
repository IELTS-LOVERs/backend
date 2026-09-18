import { z } from "zod";

export const CreateAssignmentSchema = z.object({
  body: z
    .object({
      examId: z.string().min(1, "Thiếu ID đề thi"),
      classId: z.string().min(1).optional(),
      studentId: z.string().min(1).optional(),
      deadline: z.iso.datetime().optional(),
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
    })
    .refine((data) => data.deadline !== undefined || data.status !== undefined, {
      message: "Cần cung cấp ít nhất một trường để cập nhật",
    }),
});

export type CreateAssignmentBody = z.infer<typeof CreateAssignmentSchema>["body"];
export type UpdateAssignmentBody = z.infer<typeof UpdateAssignmentSchema>["body"];

export const ListAssignmentsQuerySchema = z.object({
  query: z.object({
    classId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>["query"];
