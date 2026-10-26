import mongoose from "mongoose";
import { ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import { QuestionModel, type IBankQuestionItem, type IQuestion, type RichDocValue } from "./question.model.js";
import type { CreateQuestionBody, ListQuestionsQuery, UpdateQuestionBody } from "./question.validation.js";

export interface SerializedBankQuestionItem {
  id: string;
  prompt: string;
  promptDoc?: RichDocValue | null;
  acceptedAnswers: string[];
  points: number;
  explanation: string | null;
  mediaIds: string[];
}

export interface SerializedBankQuestionGroup {
  id: string;
  skill: IQuestion["skill"];
  part: number;
  groupType: string;
  instructions: string;
  instructionsDoc?: RichDocValue | null;
  config: Record<string, unknown>;
  questions: SerializedBankQuestionItem[];
  questionCount: number;
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
  groupType?: IQuestion["groupType"];
  createdBy?: string;
  $or?: Array<Record<string, RegExp>>;
}

function toObjectIds(ids: string[] = []): mongoose.Types.ObjectId[] {
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

function serializeItem(item: IBankQuestionItem): SerializedBankQuestionItem {
  return {
    id: item._id.toString(),
    prompt: item.prompt ?? "",
    ...(item.promptDoc ? { promptDoc: item.promptDoc } : {}),
    acceptedAnswers: item.acceptedAnswers ?? [],
    points: item.points ?? 1,
    explanation: item.explanation ?? null,
    mediaIds: (item.mediaIds ?? []).map((id) => id.toString()),
  };
}

export function serializeQuestion(question: IQuestion): SerializedBankQuestionGroup {
  const questions = (question.questions ?? []).map(serializeItem);
  return {
    id: question._id.toString(),
    skill: question.skill,
    part: question.part,
    groupType: question.groupType,
    instructions: question.instructions ?? "",
    ...(question.instructionsDoc ? { instructionsDoc: question.instructionsDoc } : {}),
    config: (question.config ?? {}) as Record<string, unknown>,
    questions,
    questionCount: questions.length,
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
): Promise<SerializedBankQuestionGroup> {
  const question = await QuestionModel.create({
    skill: data.skill,
    part: data.part,
    groupType: data.groupType as IQuestion["groupType"],
    instructions: data.instructions ?? "",
    instructionsDoc: data.instructionsDoc ?? undefined,
    config: data.config ?? {},
    questions: data.questions.map((item) => ({
      prompt: item.prompt ?? "",
      promptDoc: item.promptDoc ?? undefined,
      acceptedAnswers: item.acceptedAnswers ?? [],
      points: item.points ?? 1,
      explanation: item.explanation,
      mediaIds: toObjectIds(item.mediaIds),
    })),
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return serializeQuestion(question);
}

export async function list(
  filters: ListQuestionsFilters,
  userId?: string,
  role?: string
): Promise<{
  questions: SerializedBankQuestionGroup[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const { page, limit, skill, part, type, createdBy, scope } = filters;
  const query: QuestionFilter = {};

  if (skill) query.skill = skill;
  if (part !== undefined) query.part = part;
  if (type) query.groupType = type as IQuestion["groupType"];

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
    query.$or = [{ instructions: searchRegex }, { "questions.prompt": searchRegex }];
  }

  const [questions, total] = await Promise.all([
    QuestionModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    QuestionModel.countDocuments(query),
  ]);

  return {
    questions: questions.map((question) => serializeQuestion(question as unknown as IQuestion)),
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
): Promise<SerializedBankQuestionGroup> {
  const question = await QuestionModel.findById(id);

  if (!question) {
    throw new NotFoundError("Nhóm câu hỏi không tồn tại.");
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
    throw new NotFoundError("Nhóm câu hỏi không tồn tại.");
  }

  assertOwner(question, userId, role);

  const patch: Record<string, unknown> = {};
  if (data.skill !== undefined) patch.skill = data.skill;
  if (data.part !== undefined) patch.part = data.part;
  if (data.groupType !== undefined) patch.groupType = data.groupType;
  if (data.instructions !== undefined) patch.instructions = data.instructions;
  if (data.instructionsDoc !== undefined) {
    patch.instructionsDoc = data.instructionsDoc ?? undefined;
  }
  if (data.config !== undefined) patch.config = data.config;
  if (data.questions !== undefined) {
    patch.questions = data.questions.map((item) => ({
      prompt: item.prompt ?? "",
      promptDoc: item.promptDoc ?? undefined,
      acceptedAnswers: item.acceptedAnswers ?? [],
      points: item.points ?? 1,
      explanation: item.explanation,
      mediaIds: toObjectIds(item.mediaIds),
    }));
  }

  await QuestionModel.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  });
}

export async function remove(id: string, userId: string, role: string): Promise<void> {
  const question = await QuestionModel.findById(id);

  if (!question) {
    throw new NotFoundError("Nhóm câu hỏi không tồn tại.");
  }

  assertOwner(question, userId, role);

  // Exams embed a COPY of each group, so deleting a bank group can never break
  // an existing exam — no referential-integrity guard is needed.
  await QuestionModel.deleteOne({ _id: question._id });
}
