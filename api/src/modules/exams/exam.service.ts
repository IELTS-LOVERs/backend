import mongoose, { type Types } from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { buildCandidateExam, type CandidateExam } from "../attempts/attempt.service.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import type { SkillType } from "../questions/question.model.js";
import { ExamModel, type ExamStatus, type IExam, type IExamSection } from "./exam.model.js";
import type { CreateExamBody, ExamSectionInput, UpdateExamBody } from "./exam.validation.js";

export interface ExamSummary {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  sectionsCount: number;
}

export interface ExamListItem {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  createdAt: Date;
}

export interface SerializedQuestion {
  id: string;
  skill: SkillType;
  type: string;
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

export interface ExamSectionDetail {
  skill: SkillType;
  part: number;
  title: string;
  instructions: string | null;
  passageText: string | null;
  mediaIds: string[];
  questionIds: string[];
  questions: SerializedQuestion[];
}

export interface ExamDetail {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  sections: ExamSectionDetail[];
}

export interface StudentExamDetail extends CandidateExam {
  durationMinutes: number;
  status: ExamStatus;
}

export interface ListExamsFilters {
  status?: ExamStatus;
  page: number;
  limit: number;
}

interface ExamFilter {
  status?: ExamStatus;
  createdBy?: string;
  _id?: { $in: Types.ObjectId[] };
}

interface PopulatedQuestion {
  _id: Types.ObjectId;
  skill: SkillType;
  type: string;
  part: number;
  prompt: string;
  content?: string;
  data: Record<string, unknown>;
  acceptedAnswers: string[];
  points: number;
  explanation?: string;
  mediaIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function mapSections(sections: ExamSectionInput[]): IExamSection[] {
  return sections.map((section) => ({
    skill: section.skill,
    part: section.part,
    title: section.title,
    instructions: section.instructions,
    passageText: section.passageText,
    mediaIds: section.mediaIds?.map((mediaId) => new mongoose.Types.ObjectId(mediaId)),
    questionIds: section.questionIds.map((questionId) => new mongoose.Types.ObjectId(questionId)),
  }));
}

export function serializeQuestion(question: PopulatedQuestion): SerializedQuestion {
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
    mediaIds: question.mediaIds.map((mediaId) => mediaId.toString()),
    createdBy: question.createdBy.toString(),
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

export function assertOwnership(
  exam: Pick<IExam, "createdBy">,
  userId: string,
  role: string
): void {
  if (role === "admin") return;

  if (exam.createdBy.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }
}

async function findOwnedExam(id: string, userId: string, role: string): Promise<IExam> {
  const exam = await ExamModel.findById(id);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  assertOwnership(exam, userId, role);
  return exam;
}

export async function create(data: CreateExamBody, userId: string): Promise<ExamSummary> {
  const exam = await ExamModel.create({
    title: data.title,
    description: data.description,
    durationMinutes: data.durationMinutes,
    sections: mapSections(data.sections),
    status: "draft",
    openAt: data.openAt ? new Date(data.openAt) : undefined,
    closeAt: data.closeAt ? new Date(data.closeAt) : undefined,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return {
    id: exam._id.toString(),
    title: exam.title,
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    sectionsCount: exam.sections.length,
  };
}

export async function getAssignedExamIds(studentId: string): Promise<Types.ObjectId[]> {
  const classes = await ClassModel.find({ students: studentId }).select("_id");
  const classIds = classes.map((cls) => cls._id);

  const assignments = await AssignmentModel.find({
    status: "active",
    $or: [{ classId: { $in: classIds } }, { studentId }],
  }).select("examId");

  return assignments.map((assignment) => assignment.examId);
}

export async function list(
  userId: string,
  role: string,
  filters: ListExamsFilters
): Promise<{
  exams: ExamListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const { status, page, limit } = filters;
  const query: ExamFilter = {};

  if (role === "student") {
    query.status = "published";
    query._id = { $in: await getAssignedExamIds(userId) };
  } else {
    if (role !== "admin") query.createdBy = userId;
    if (status) query.status = status;
  }

  const [exams, total] = await Promise.all([
    ExamModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ExamModel.countDocuments(query),
  ]);

  return {
    exams: exams.map((exam) => ({
      id: exam._id.toString(),
      title: exam.title,
      durationMinutes: exam.durationMinutes,
      status: exam.status,
      createdAt: exam.createdAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getById(
  id: string,
  userId?: string,
  role?: string
): Promise<ExamDetail | StudentExamDetail> {
  const exam = await ExamModel.findById(id).populate("sections.questionIds");

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  if (role === "student") {
    if (exam.status !== "published") {
      throw new ForbiddenError("FORBIDDEN", "Học sinh chỉ có thể xem đề thi đã xuất bản.");
    }

    return {
      ...buildCandidateExam(exam),
      durationMinutes: exam.durationMinutes,
      status: exam.status,
    };
  }

  if (userId && role && role !== "admin" && exam.createdBy.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }

  const sections: ExamSectionDetail[] = exam.sections.map((section) => {
    const rawQuestions = section.questionIds as unknown as (PopulatedQuestion | null)[] | undefined;
    const questions = (rawQuestions ?? [])
      .filter((question): question is PopulatedQuestion => question !== null)
      .map(serializeQuestion);

    return {
      skill: section.skill,
      part: section.part,
      title: section.title,
      instructions: section.instructions ?? null,
      passageText: section.passageText ?? null,
      mediaIds: (section.mediaIds ?? []).map((mediaId) => mediaId.toString()),
      questionIds: questions.map((question) => question.id),
      questions,
    };
  });

  return {
    id: exam._id.toString(),
    title: exam.title,
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    sections,
  };
}

export async function update(
  id: string,
  data: UpdateExamBody,
  userId: string,
  role: string
): Promise<void> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status !== "draft") {
    throw new BadRequestError(
      "EXAM_CANNOT_EDIT_PUBLISHED",
      "Không thể sửa hoặc xóa đề thi đã xuất bản."
    );
  }

  if (data.title !== undefined) exam.title = data.title;
  if (data.description !== undefined) exam.description = data.description;
  if (data.durationMinutes !== undefined) exam.durationMinutes = data.durationMinutes;
  if (data.sections !== undefined) exam.sections = mapSections(data.sections);
  if (data.openAt !== undefined) exam.openAt = new Date(data.openAt);
  if (data.closeAt !== undefined) exam.closeAt = new Date(data.closeAt);

  await exam.save();
}

export async function remove(id: string, userId: string, role: string): Promise<void> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status !== "draft") {
    throw new BadRequestError(
      "EXAM_CANNOT_EDIT_PUBLISHED",
      "Không thể sửa hoặc xóa đề thi đã xuất bản."
    );
  }

  await ExamModel.deleteOne({ _id: exam._id });
}

export async function clone(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; title: string; status: ExamStatus }> {
  const original = await ExamModel.findById(id);

  if (!original) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  assertOwnership(original, userId, role);

  const cloned = await ExamModel.create({
    title: `[Bản sao] ${original.title}`,
    description: original.description,
    durationMinutes: original.durationMinutes,
    sections: original.sections.map((section) => ({
      skill: section.skill,
      part: section.part,
      title: section.title,
      instructions: section.instructions,
      passageText: section.passageText,
      mediaIds: section.mediaIds,
      questionIds: section.questionIds,
    })),
    status: "draft",
    openAt: original.openAt,
    closeAt: original.closeAt,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return { id: cloned._id.toString(), title: cloned.title, status: cloned.status };
}

export async function publish(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  if (
    exam.sections.length === 0 ||
    exam.sections.every((s) => s.questionIds.length === 0)
  ) {
    throw new BadRequestError(
      "EXAM_EMPTY",
      "Đề thi phải có ít nhất một câu hỏi để xuất bản."
    );
  }

  exam.status = "published";
  await exam.save();

  return { id: exam._id.toString(), status: exam.status };
}

export async function unpublish(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status !== "published") {
    throw new BadRequestError(
      "EXAM_NOT_PUBLISHED",
      "Chỉ có thể hủy xuất bản đề thi đang ở trạng thái published."
    );
  }

  const attemptCount = await AttemptModel.countDocuments({ examId: exam._id });
  if (attemptCount > 0) {
    throw new BadRequestError(
      "EXAM_HAS_ATTEMPTS",
      "Không thể hủy xuất bản đề thi đã có học sinh làm bài."
    );
  }

  exam.status = "draft";
  await exam.save();

  return { id: exam._id.toString(), status: exam.status };
}

export async function close(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  exam.status = "closed";
  await exam.save();

  return { id: exam._id.toString(), status: exam.status };
}
