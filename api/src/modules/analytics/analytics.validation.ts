import { z } from "zod";

export const ExamAnalyticsSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID đề thi"),
  }),
});

export const ClassAnalyticsSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID lớp học"),
  }),
});

export const StudentProgressSchema = z.object({
  query: z.object({
    studentId: z.string().optional(),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }),
});

export type StudentProgressQueryInput = z.infer<typeof StudentProgressSchema>["query"];
