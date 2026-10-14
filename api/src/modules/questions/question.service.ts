import mongoose, { type UpdateQuery } from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import { ExamModel } from "../exams/exam.model.js";
import { QuestionModel, type IQuestion } from "./question.model.js";
import type { CreateQuestionBody, ListQuestionsQuery, UpdateQuestionBody } from "./question.validation.js";

export interface SerializedQuestion {
  id: string;
  skill: IQuestion["skill"];
  type: IQuestion["type"];
  part: number;
  prompt: string;
  content: string | null;
  data: Record<string, unknown>;
  acceptedAnswers: string[];
  points: number;
  explanation: string | null;
  mediaIds: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListQuestionsFilters extends ListQuestionsQuery {
  search?: string;
}

interface QuestionFilter {
  skill?: IQuestion["skill"];
  part?: number;
  type?: IQuestion["type"];
  createdBy?: string;
  $or?: Array<{ prompt?: RegExp; content?: RegExp }>;
}

export function serializeQuestion(question: IQuestion): SerializedQuestion {
  return {
    id: question._id.toString(),
    skill: question.skill,
    type: question.type,
    part: question.part,
    prompt: question.prompt,
    content: question.content ?? null,
    data: question.data,
    acceptedAnswers: question.acceptedAnswers,
    points: question.points,
    explanation: question.explanation ?? null,
    mediaIds: question.mediaIds.map((id) => id.toString()),
    createdBy: question.createdBy.toString(),
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

export function assertOwner(
  question: Pick<IQuestion, "createdBy">,
  userId: string,
  role: string
): void {
  if (role === "admin") return;

  if (question.createdBy.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }
}

export async function create(
  data: CreateQuestionBody,
  userId: string
): Promise<SerializedQuestion> {
  const question = await QuestionModel.create({
    ...data,
    type: data.type as IQuestion["type"],
    mediaIds: data.mediaIds.map((mediaId) => new mongoose.Types.ObjectId(mediaId)),
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return serializeQuestion(question);
}

export async function list(
  filters: ListQuestionsFilters,
  userId?: string,
  role?: string
): Promise<{
  questions: SerializedQuestion[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const { page, limit, skill, part, type, createdBy, scope } = filters;
  const query: QuestionFilter = {};

  if (skill) query.skill = skill;
  if (part !== undefined) query.part = part;
  if (type) query.type = type as IQuestion["type"];

  if (scope === "all") {
    if (createdBy) query.createdBy = createdBy;
  } else if (role !== "admin" && userId) {
    query.createdBy = userId;
  } else if (createdBy) {
    query.createdBy = createdBy;
  }

  if (filters.search && filters.search.trim().length > 0) {
    // Same hardening as user search (FIX-21): escape before building the regex.
    const searchRegex = new RegExp(escapeRegExp(filters.search.trim()), "i");
    query.$or = [{ prompt: searchRegex }, { content: searchRegex }];
  }

  const [questions, total] = await Promise.all([
    QuestionModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    QuestionModel.countDocuments(query),
  ]);

  return {
    questions: questions.map(serializeQuestion),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getById(
  id: string,
  userId?: string,
  role?: string,
  scope?: "own" | "all"
): Promise<SerializedQuestion> {
  const question = await QuestionModel.findById(id);

  if (!question) {
    throw new NotFoundError("Câu hỏi không tồn tại.");
  }

  if (
    scope !== "all" &&
    role !== "admin" &&
    userId &&
    question.createdBy.toString() !== userId
  ) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }

  return serializeQuestion(question);
}

export async function update(
  id: string,
  data: UpdateQuestionBody,
  userId: string,
  role: string
): Promise<void> {
  const question = await QuestionModel.findById(id);

  if (!question) {
    throw new NotFoundError("Câu hỏi không tồn tại.");
  }

  assertOwner(question, userId, role);

  const updatePayload = { ...data } as UpdateQuery<IQuestion>;
  if (data.mediaIds) {
    updatePayload.mediaIds = data.mediaIds.map((mediaId) => new mongoose.Types.ObjectId(mediaId));
  }

  await QuestionModel.findByIdAndUpdate(id, updatePayload, {
    new: true,
    runValidators: true,
  });
}

export async function remove(id: string, userId: string, role: string): Promise<void> {
  const question = await QuestionModel.findById(id);

  if (!question) {
    throw new NotFoundError("Câu hỏi không tồn tại.");
  }

  assertOwner(question, userId, role);

  const examUsingQuestion = await ExamModel.findOne({
    "sections.questionIds": question._id,
    status: { $in: ["published", "closed"] },
  }).select("_id title status");

  if (examUsingQuestion) {
    throw new BadRequestError(
      "QUESTION_IN_USE",
      `Không thể xóa câu hỏi đang được sử dụng trong đề thi "${examUsingQuestion.title}" (${examUsingQuestion.status}).`
    );
  }

  await QuestionModel.deleteOne({ _id: question._id });
}
