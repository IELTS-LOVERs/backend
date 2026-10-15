import mongoose, { type Types } from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { logger } from "../../common/utils/logger.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import {
  buildCandidateExam,
  examMediaPresignTtl,
  getGroupConfigImageId,
  presignMediaMap,
  shouldEnforceWordLimit,
  toCandidateMediaItem,
  type CandidateExam,
  type CandidateMediaItem,
} from "../attempts/attempt.service.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";
import {
  ExamModel,
  type ExamStatus,
  type IExam,
  type IExamSection,
  type IQuestionGroup,
  type IQuestionItem,
} from "./exam.model.js";
import type {
  CreateExamBody,
  ExamSectionInput,
  QuestionGroupInput,
  QuestionItemInput,
  UpdateExamBody,
  UpdateExamMetadataBody,
} from "./exam.validation.js";

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

export interface SerializedQuestionItem {
  id: string;
  questionNumber: number;
  prompt: string;
  acceptedAnswers: string[];
  points: number;
  explanation: string | null;
  mediaIds: string[];
}

export interface SerializedQuestionGroup {
  id: string;
  groupType: QuestionGroupType;
  instructions: string;
  config: Record<string, unknown>;
  /** Resolved group-level image (config.imageMediaId) with a presigned URL. */
  media: CandidateMediaItem[];
  questions: SerializedQuestionItem[];
}

export interface ExamSectionDetail {
  id: string;
  skill: SkillType;
  part: number;
  title: string;
  instructions: string | null;
  passageText: string | null;
  transcript: string | null;
  mediaIds: string[];
  media: CandidateMediaItem[];
  questionGroups: SerializedQuestionGroup[];
}

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  status: ExamStatus;
  openAt: Date | null;
  closeAt: Date | null;
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

export function getDefaultSectionTitle(skill: SkillType, part: number): string {
  if (skill === 'reading') return `Passage ${part}`;
  if (skill === 'writing') return `Task ${part}`;
  return `Part ${part}`;
}

/** Check if a section uses the new questionGroups format */
export function sectionUsesGroups(section: IExamSection): boolean {
  return Array.isArray(section.questionGroups) && section.questionGroups.length > 0;
}

function toSafeObjectId(id: unknown): Types.ObjectId | undefined {
  if (!id) return undefined;
  const str = String(id).trim();
  if (mongoose.Types.ObjectId.isValid(str) && /^[0-9a-fA-F]{24}$/.test(str)) {
    return new mongoose.Types.ObjectId(str);
  }
  return undefined;
}

/** Extract an ObjectId string from a raw ObjectId, a populated Media doc, or null. */
function extractMediaId(item: unknown): string {
  if (item === null || item === undefined) return "";
  if (typeof item === "object" && "_id" in item) {
    const id = (item as { _id?: unknown })._id;
    return id ? String(id) : "";
  }
  return String(item);
}

function mapQuestionItemInput(item: QuestionItemInput): Partial<IQuestionItem> {
  const safeId = toSafeObjectId(item._id);
  const mediaIds = (item.mediaIds ?? [])
    .map(toSafeObjectId)
    .filter((id): id is Types.ObjectId => id !== undefined);

  return {
    ...(safeId ? { _id: safeId } : {}),
    questionNumber: item.questionNumber,
    prompt: item.prompt ?? "",
    acceptedAnswers: item.acceptedAnswers ?? [],
    points: item.points ?? 1,
    explanation: item.explanation ?? undefined,
    mediaIds,
  };
}

function mapQuestionGroupInput(group: QuestionGroupInput): Partial<IQuestionGroup> {
  const safeId = toSafeObjectId(group._id);
  return {
    ...(safeId ? { _id: safeId } : {}),
    groupType: group.groupType as QuestionGroupType,
    instructions: group.instructions ?? "",
    config: group.config ?? {},
    questions: (group.questions ?? []).map(mapQuestionItemInput) as IQuestionItem[],
  };
}

export function mapSections(sections: ExamSectionInput[]): IExamSection[] {
  return sections.map((section) => {
    const safeId = toSafeObjectId(section._id);
    const mediaIds = (section.mediaIds ?? [])
      .map(toSafeObjectId)
      .filter((mediaId): mediaId is Types.ObjectId => mediaId !== undefined);

    return {
      ...(safeId ? { _id: safeId } : {}),
      skill: section.skill,
      part: section.part,
      title: section.title?.trim() || getDefaultSectionTitle(section.skill, section.part),
      instructions: section.instructions ?? undefined,
      passageText: section.passageText ?? undefined,
      transcript: section.transcript ?? undefined,
      mediaIds,
      questionGroups: (section.questionGroups ?? []).map(mapQuestionGroupInput) as IQuestionGroup[],
    } as IExamSection;
  });
}

function serializeQuestionItem(item: IQuestionItem): SerializedQuestionItem {
  return {
    id: item._id?.toString() ?? "",
    questionNumber: item.questionNumber,
    prompt: item.prompt ?? "",
    acceptedAnswers: item.acceptedAnswers ?? [],
    points: item.points ?? 1,
    explanation: item.explanation ?? null,
    mediaIds: (item.mediaIds ?? []).map((id) => id?.toString() ?? "").filter(Boolean),
  };
}

function serializeQuestionGroup(
  group: IQuestionGroup,
  mediaUrlMap?: Map<string, string>
): SerializedQuestionGroup {
  // Group-level image (config.imageMediaId) — resolve the presigned URL for the
  // teacher UI (preview/editor thumbnail). The raw id stays in `config`.
  const imageId = getGroupConfigImageId(group);
  const imageUrl = imageId ? mediaUrlMap?.get(imageId) : undefined;
  const media: CandidateMediaItem[] =
    imageId && imageUrl
      ? [{ id: imageId, url: imageUrl, type: "image", originalName: "" }]
      : [];

  return {
    id: group._id?.toString() ?? "",
    groupType: group.groupType,
    instructions: group.instructions ?? "",
    config: group.config ?? {},
    media,
    questions: (group.questions ?? []).map(serializeQuestionItem),
  };
}

export function assertOwnership(
  exam: Pick<IExam, "createdBy">,
  userId: string,
  role: string
): void {
  if (role === "admin") return;

  if (exam.createdBy?.toString() !== userId) {
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
    description: data.description ?? undefined,
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
  const exam = await ExamModel.findById(id).populate([
    { path: "sections.mediaIds", model: "Media" },
  ]);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  const mediaUrlMap = await presignMediaMap(
    exam,
    examMediaPresignTtl(exam.durationMinutes)
  );

  if (role === "student") {
    if (exam.status === "draft") {
      throw new ForbiddenError("FORBIDDEN", "Học sinh chỉ có thể xem đề thi đã xuất bản.");
    }

    return {
      ...buildCandidateExam(exam, mediaUrlMap),
      durationMinutes: exam.durationMinutes,
      status: exam.status,
    };
  }

  if (userId && role && role !== "admin" && exam.createdBy?.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }

  const sections: ExamSectionDetail[] = exam.sections.map((section) => {
    const sectionMediaIds = (section.mediaIds ?? []).map(extractMediaId).filter(Boolean);
    const sectionMedia = (section.mediaIds ?? [])
      .map((item) => toCandidateMediaItem(item, mediaUrlMap))
      .filter((media): media is CandidateMediaItem => media !== null);

    return {
      id: section._id?.toString() ?? "",
      skill: section.skill,
      part: section.part,
      title: section.title?.trim() || getDefaultSectionTitle(section.skill, section.part),
      instructions: section.instructions ?? null,
      passageText: section.passageText ?? null,
      transcript: section.transcript ?? null,
      mediaIds: sectionMediaIds,
      media: sectionMedia,
      questionGroups: (section.questionGroups ?? []).map((group) =>
        serializeQuestionGroup(group, mediaUrlMap)
      ),
    };
  });

  return {
    id: exam._id.toString(),
    title: exam.title,
    description: exam.description ?? null,
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    openAt: exam.openAt ?? null,
    closeAt: exam.closeAt ?? null,
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
  if (data.description !== undefined) exam.description = data.description ?? undefined;
  if (data.durationMinutes !== undefined) exam.durationMinutes = data.durationMinutes;
  if (data.sections !== undefined) exam.sections = mapSections(data.sections);
  if (data.openAt !== undefined) exam.openAt = data.openAt ? new Date(data.openAt) : undefined;
  if (data.closeAt !== undefined) exam.closeAt = data.closeAt ? new Date(data.closeAt) : undefined;

  await exam.save();
}

/** Allow editing metadata (title, description, open/close times) on published exams */
export async function updateMetadata(
  id: string,
  data: UpdateExamMetadataBody,
  userId: string,
  role: string
): Promise<void> {
  const exam = await findOwnedExam(id, userId, role);

  if (data.title !== undefined) exam.title = data.title;
  if (data.description !== undefined) exam.description = data.description ?? undefined;
  if (data.openAt !== undefined) exam.openAt = data.openAt ? new Date(data.openAt) : undefined;
  if (data.closeAt !== undefined) exam.closeAt = data.closeAt ? new Date(data.closeAt) : undefined;

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
      transcript: section.transcript,
      mediaIds: section.mediaIds,
      questionGroups: section.questionGroups,
    })),
    status: "draft",
    openAt: original.openAt,
    closeAt: original.closeAt,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  return { id: cloned._id.toString(), title: cloned.title, status: cloned.status };
}

/** Count total questions across all sections. */
function countExamQuestions(exam: IExam): number {
  let count = 0;
  for (const section of exam.sections) {
    for (const group of section.questionGroups) {
      count += group.questions.length;
    }
  }
  return count;
}

export async function publish(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.sections.length === 0 || countExamQuestions(exam) === 0) {
    throw new BadRequestError(
      "EXAM_EMPTY",
      "Đề thi phải có ít nhất một câu hỏi để xuất bản."
    );
  }

  if (exam.durationMinutes !== undefined && (exam.durationMinutes < 10 || exam.durationMinutes > 180)) {
    throw new BadRequestError(
      "EXAM_INVALID_DURATION",
      "Thời lượng đề thi phải từ 10 đến 180 phút."
    );
  }

  if (exam.openAt && exam.closeAt && exam.openAt >= exam.closeAt) {
    throw new BadRequestError(
      "EXAM_INVALID_DATES",
      "Thời gian mở đề thi phải trước thời gian đóng đề thi."
    );
  }

  for (const section of exam.sections) {
    if (sectionUsesGroups(section)) {
      for (const group of section.questionGroups) {
        if (group.questions.length === 0) {
          throw new BadRequestError(
            "EXAM_GROUP_EMPTY",
            `Nhóm câu hỏi trong phần ${section.title || section.part} không được để trống.`
          );
        }
        if (section.skill !== "writing") {
          for (const q of group.questions) {
            if (!q.acceptedAnswers || q.acceptedAnswers.length === 0) {
              throw new BadRequestError(
                "EXAM_QUESTION_MISSING_ANSWER",
                `Câu hỏi số ${q.questionNumber} chưa có đáp án đúng.`
              );
            }
          }
        }

        // FIX-11: warn when maxWords is set on a group type that ignores it.
        const configuredMaxWords = (group.config as { maxWords?: unknown } | undefined)
          ?.maxWords;
        if (
          typeof configuredMaxWords === "number" &&
          !shouldEnforceWordLimit(group.groupType)
        ) {
          logger.warn("exam.publish_word_limit_ignored", {
            examId: exam._id.toString(),
            groupType: group.groupType,
            maxWords: configuredMaxWords,
          });
        }
      }
    }
  }

  // FIX-08/M-03: listening/reading must total 40 points (writing is band-scored).
  for (const section of exam.sections) {
    if (section.skill === "writing") continue;

    let sectionPoints = 0;
    for (const group of section.questionGroups) {
      for (const q of group.questions) {
        sectionPoints += q.points ?? 1;
      }
    }

    if (sectionPoints > 40) {
      throw new BadRequestError(
        "EXAM_POINTS_EXCEEDS_40",
        `Phần ${section.title || section.part} có tổng điểm ${sectionPoints}, vượt quá 40 điểm của một kỹ năng IELTS.`
      );
    }

    if (sectionPoints > 0 && sectionPoints !== 40) {
      logger.warn("exam.publish_points_mismatch", {
        examId: exam._id.toString(),
        skill: section.skill,
        part: section.part,
        sectionPoints,
      });
    }
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
