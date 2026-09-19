import { z } from "zod";

const SkillEnum = z.enum(["listening", "reading", "writing"]);

const ExamSectionInputSchema = z.object({
  skill: SkillEnum,
  part: z.number().int().min(1).max(4),
  title: z.string().optional().default(""),
  instructions: z.string().optional(),
  passageText: z.string().optional(),
  mediaIds: z.array(z.string()).optional(),
  questionIds: z.array(z.string()).default([]),
});

export const CreateExamSchema = z.object({
  body: z.object({
    title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự"),
    description: z.string().optional(),
    durationMinutes: z.number().int().min(10).max(180).default(60),
    sections: z.array(ExamSectionInputSchema).default([]),
    openAt: z.iso.datetime().optional(),
    closeAt: z.iso.datetime().optional(),
  }),
});

export const UpdateExamSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID đề thi"),
  }),
  body: CreateExamSchema.shape.body.partial(),
});

export const ListExamsSchema = z.object({
  query: z.object({
    status: z.enum(["draft", "published", "closed"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export type ExamSectionInput = z.infer<typeof ExamSectionInputSchema>;
export type CreateExamBody = z.infer<typeof CreateExamSchema>["body"];
export type UpdateExamBody = z.infer<typeof UpdateExamSchema>["body"];
export type ListExamsQuery = z.infer<typeof ListExamsSchema>["query"];
