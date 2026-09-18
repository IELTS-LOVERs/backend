import { z } from "zod";

const SkillEnum = z.enum(["listening", "reading", "writing"]);

export const CreateQuestionSchema = z.object({
  body: z.object({
    skill: SkillEnum,
    type: z.string().min(1, "Loại câu hỏi không hợp lệ"),
    part: z.number().int().min(1).max(4),
    prompt: z.string().min(1, "Nội dung câu hỏi không được để trống"),
    content: z.string().optional(),
    data: z.record(z.string(), z.any()).default({}),
    acceptedAnswers: z.array(z.string()).default([]),
    points: z.number().default(1),
    explanation: z.string().optional(),
    mediaIds: z.array(z.string()).default([]),
  }),
});

export const UpdateQuestionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID câu hỏi"),
  }),
  body: CreateQuestionSchema.shape.body.partial(),
});

export const ListQuestionsSchema = z.object({
  query: z.object({
    skill: SkillEnum.optional(),
    part: z.coerce.number().int().min(1).max(4).optional(),
    type: z.string().optional(),
    createdBy: z.string().optional(),
    scope: z.enum(["own", "all"]).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export type CreateQuestionBody = z.infer<typeof CreateQuestionSchema>["body"];
export type UpdateQuestionBody = z.infer<typeof UpdateQuestionSchema>["body"];
export type ListQuestionsQuery = z.infer<typeof ListQuestionsSchema>["query"];
