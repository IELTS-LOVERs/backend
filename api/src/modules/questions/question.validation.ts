import { z } from "zod";
import { RichDocSchema } from "../exams/exam.validation.js";

const SkillEnum = z.enum(["listening", "reading", "writing"]);

/** One answer slot inside a bank Question Group. */
const BankQuestionItemSchema = z.object({
  prompt: z.string().default(""),
  promptDoc: RichDocSchema.optional().nullable(),
  acceptedAnswers: z.array(z.string()).default([]),
  points: z.number().int("Điểm phải là số nguyên").min(1).max(10).default(1),
  explanation: z.string().optional(),
  mediaIds: z.array(z.string()).default([]),
});

/**
 * The Question Bank stores Question *Groups* (same shape embedded in an exam
 * section). A group always has a `groupType`, shared `instructions` + `config`,
 * and at least one question.
 */
export const CreateQuestionSchema = z.object({
  body: z.object({
    skill: SkillEnum,
    part: z.number().int().min(1).max(4),
    groupType: z.string().min(1, "Dạng câu hỏi không hợp lệ"),
    instructions: z.string().default(""),
    instructionsDoc: RichDocSchema.optional().nullable(),
    config: z.record(z.string(), z.any()).default({}),
    questions: z.array(BankQuestionItemSchema).min(1, "Nhóm câu hỏi phải có ít nhất 1 câu"),
  }),
});

/**
 * Update body MUST be a genuine partial schema without Zod `.default()` injection
 * at the top level. In Zod v4, `.partial()` leaves inner `.default()` values in
 * place, so `CreateQuestionSchema.shape.body.partial()` would inject
 * `instructions: ""` / `config: {}` into every PUT, wiping stored data whenever a
 * caller updates only part of a group. Fields are therefore declared optional
 * explicitly here.
 *
 * (Item-level defaults on `questions` are fine: sending `questions` replaces the
 * whole array anyway.)
 */
export const UpdateQuestionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID nhóm câu hỏi"),
  }),
  body: z.object({
    skill: SkillEnum.optional(),
    part: z.number().int().min(1).max(4).optional(),
    groupType: z.string().min(1, "Dạng câu hỏi không hợp lệ").optional(),
    instructions: z.string().optional(),
    instructionsDoc: RichDocSchema.optional().nullable(),
    config: z.record(z.string(), z.any()).optional(),
    questions: z.array(BankQuestionItemSchema).min(1, "Nhóm câu hỏi phải có ít nhất 1 câu").optional(),
  }),
});

export const ListQuestionsSchema = z.object({
  query: z.object({
    skill: SkillEnum.optional(),
    part: z.coerce.number().int().min(1).max(4).optional(),
    /** Matches the group's `groupType`. */
    type: z.string().optional(),
    createdBy: z.string().optional(),
    scope: z.enum(["own", "all"]).optional(),
    search: z.string().max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export type CreateQuestionBody = z.infer<typeof CreateQuestionSchema>["body"];
export type UpdateQuestionBody = z.infer<typeof UpdateQuestionSchema>["body"];
export type ListQuestionsQuery = z.infer<typeof ListQuestionsSchema>["query"];
