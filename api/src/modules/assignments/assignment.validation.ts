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

export type CreateAssignmentBody = z.infer<typeof CreateAssignmentSchema>["body"];
