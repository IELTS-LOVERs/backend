import mongoose, { type Types } from "mongoose";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { logger } from "../../common/utils/logger.js";
import {
  defaultThresholdsForSkill,
  normalizeBandConversion,
  validateBandConversion,
} from "../../common/utils/band-conversion.js";
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
import { AssignmentModel } from "../assignments/assignment.model.js";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";
import {
  ExamModel,
  type ExamStatus,
  type ExamKind,
  type ExamScoringMode,
  type IBandConversion,
  type IExamCurriculum,
  type IExamPostSubmissionResources,
  type IExam,
  type IExamSection,
  type IQuestionGroup,
  type IQuestionItem,
  type RichDocValue,
} from "./exam.model.js";
import { canStudentAccessExam, getAssignedExamIds } from "./exam.access.js";
import type {
  BandConversionInput,
  CreateExamBody,
  CurriculumInput,
  ExamSectionInput,
  PostSubmissionResourcesInput,
  QuestionGroupInput,
  QuestionItemInput,
  UpdateExamBody,
  UpdateExamCurriculumBody,
  UpdateExamMetadataBody,
  UpdateExamResourcesBody,
} from "./exam.validation.js";

export { canStudentAccessExam, getAssignedExamIds };

export interface ExamSummary {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  disableTextSelection?: boolean;
  curriculum?: IExamCurriculum;
  sectionsCount: number;
  type?: ExamKind;
}

export interface ExamListItem {
  id: string;
  title: string;
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  curriculum?: IExamCurriculum;
  sectionsCount: number;
  createdAt: Date;
  type?: ExamKind;
}

export interface SerializedQuestionItem {
  id: string;
  questionNumber: number;
  prompt: string;
  promptDoc?: RichDocValue | null;
  acceptedAnswers: string[];
  points: number;
  explanation: string | null;
  mediaIds: string[];
}

export interface SerializedQuestionGroup {
  id: string;
  groupType: QuestionGroupType;
  instructions: string;
  instructionsDoc?: RichDocValue | null;
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
  instructionsDoc?: RichDocValue | null;
  passageText: string | null;
  passageDoc?: RichDocValue | null;
  transcript: string | null;
  mediaIds: string[];
  media: CandidateMediaItem[];
  questionGroups: SerializedQuestionGroup[];
}

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  bannerUrl?: string | null;
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode: ExamScoringMode;
  bandConversion?: IBandConversion;
  disableTextSelection: boolean;
  bandConversionDefaults?: {
    listening: Array<{ minRaw: number; band: number }>;
    readingAcademic: Array<{ minRaw: number; band: number }>;
    readingGeneral: Array<{ minRaw: number; band: number }>;
  };
  curriculum?: IExamCurriculum;
  postSubmissionResources?: IExamPostSubmissionResources;
  openAt: Date | null;
  closeAt: Date | null;
  /** True when at least one student has attempted this exam (teacher view). */
  hasAttempts?: boolean;
  /** True when the exam is assigned to at least one class (teacher view). */
  hasAssignments?: boolean;
  sections: ExamSectionDetail[];
  type?: ExamKind;
}

export interface StudentExamDetail extends CandidateExam {
  durationMinutes: number;
  status: ExamStatus;
  kind: ExamKind;
  scoringMode?: ExamScoringMode;
  bandConversion?: IBandConversion;
  curriculum?: IExamCurriculum;
  type?: ExamKind;
}

export interface ListExamsFilters {
  status?: ExamStatus;
  kind?: ExamKind;
  type?: ExamKind;
  page: number;
  limit: number;
}

interface ExamFilter {
  status?: ExamStatus;
  kind?: ExamKind | { $in: Array<ExamKind | null> };
  createdBy?: string;
  _id?: { $in: Types.ObjectId[] };
}

/**
 * Legacy exams were created before `kind` existed. In Mongo, `null` inside
 * `$in` also matches missing fields, so mock filters must include both
 * `"mock"` and `null` during/after migration.
 */
export function examKindFilter(
  kind: ExamKind
): ExamKind | { $in: Array<ExamKind | null> } {
  return kind === "mock" ? { $in: ["mock", null] } : "practice";
}

export function getDefaultSectionTitle(skill: SkillType, part: number): string {
  if (skill === "reading") return `Passage ${part}`;
  if (skill === "writing") return `Task ${part}`;
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
    promptDoc: item.promptDoc ?? undefined,
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
    instructionsDoc: group.instructionsDoc ?? undefined,
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
      instructionsDoc: section.instructionsDoc ?? undefined,
      passageText: section.passageText ?? undefined,
      passageDoc: section.passageDoc ?? undefined,
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
    ...(item.promptDoc ? { promptDoc: item.promptDoc } : {}),
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
    ...(group.instructionsDoc ? { instructionsDoc: group.instructionsDoc } : {}),
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

function mapCurriculumInput(curriculum?: CurriculumInput | null): IExamCurriculum | undefined {
  if (!curriculum) return undefined;
  return {
    collectionName: curriculum.collectionName ?? undefined,
    testNumber: curriculum.testNumber ?? undefined,
    part: curriculum.part ?? curriculum.partOrPassage ?? undefined,
    orderIndex: curriculum.orderIndex ?? undefined,
  };
}

function mapResourcesInput(resources?: PostSubmissionResourcesInput | null): IExamPostSubmissionResources | undefined {
  if (!resources) return undefined;
  return {
    solutionVideoUrl: resources.solutionVideoUrl ?? undefined,
    solutionDocumentUrl: resources.solutionDocumentUrl ?? undefined,
    solutionNotes: resources.solutionNotes ?? undefined,
    vocabularyItems: (resources.vocabularyItems ?? []).map((v) => ({
      word: v.word,
      phonetic: v.phonetic ?? undefined,
      meaning: v.meaning,
      contextSentence: v.contextSentence ?? undefined,
    })),
  };
}

function mapBandConversionInput(
  input?: BandConversionInput | null
): IBandConversion | undefined {
  if (!input) return undefined;
  const config = normalizeBandConversion(input);
  const issues = validateBandConversion(config);
  if (issues.length > 0) {
    throw new BadRequestError("EXAM_BAND_CONVERSION_INVALID", issues.join(" "));
  }
  return config;
}

function sameBandConversion(
  a?: IBandConversion | null,
  b?: IBandConversion | null
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function resolveExamBandConversion(
  kind: ExamKind,
  scoringMode: ExamScoringMode,
  config?: IBandConversion | null
): IBandConversion | undefined {
  if (kind === "practice" || scoringMode === "raw") return undefined;
  return normalizeBandConversion(config);
}

export async function create(data: CreateExamBody, userId: string): Promise<ExamSummary> {
  const kind = data.kind ?? data.type ?? "mock";
  const scoringMode: ExamScoringMode =
    kind === "practice" ? "raw" : data.scoringMode ?? "band";
  const bandConversion =
    kind === "mock" && scoringMode === "band"
      ? mapBandConversionInput(data.bandConversion) ?? normalizeBandConversion()
      : undefined;

  const exam = await ExamModel.create({
    title: data.title,
    description: data.description ?? undefined,
    bannerUrl: data.bannerUrl ?? undefined,
    kind,
    scoringMode,
    bandConversion,
    disableTextSelection: data.disableTextSelection ?? false,
    curriculum: mapCurriculumInput(data.curriculum),
    postSubmissionResources: mapResourcesInput(data.postSubmissionResources),
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
    kind: exam.kind,
    scoringMode: exam.scoringMode,
    bandConversion: exam.bandConversion,
    disableTextSelection: exam.disableTextSelection ?? false,
    curriculum: exam.curriculum,
    sectionsCount: exam.sections.length,
    type: exam.kind,
  };
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
  const { status, kind, type, page, limit } = filters;
  const requestedKind = kind ?? type;
  const query: ExamFilter = {};

  if (role === "student") {
    query.status = "published";
    query._id = { $in: await getAssignedExamIds(userId) };
    if (requestedKind) query.kind = examKindFilter(requestedKind);
  } else {
    if (role !== "admin") query.createdBy = userId;
    if (status) query.status = status;
    if (requestedKind) query.kind = examKindFilter(requestedKind);
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
      kind: exam.kind ?? "mock",
      scoringMode:
        (exam.kind ?? "mock") === "practice"
          ? "raw"
          : exam.scoringMode ?? "band",
      bandConversion: exam.kind === "practice" ? undefined : exam.bandConversion,
      curriculum: exam.curriculum,
      sectionsCount: exam.sections?.length ?? 0,
      createdAt: exam.createdAt,
      type: exam.kind ?? "mock",
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
    const allowed = await canStudentAccessExam(userId!, exam);
    if (!allowed) {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Học sinh không có quyền truy cập đề thi này."
      );
    }

    return {
      ...buildCandidateExam(exam, mediaUrlMap),
      durationMinutes: exam.durationMinutes,
      status: exam.status,
      kind: exam.kind ?? "mock",
      scoringMode:
        (exam.kind ?? "mock") === "practice"
          ? "raw"
          : exam.scoringMode ?? "band",
      bandConversion: exam.kind === "practice" ? undefined : exam.bandConversion,
      curriculum: exam.curriculum,
      type: exam.kind ?? "mock",
    };
  }

  if (userId && role && role !== "admin" && exam.createdBy?.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }

  const [hasAttempts, hasAssignments] = await Promise.all([
    AttemptModel.exists({ examId: exam._id }),
    AssignmentModel.exists({ examId: exam._id }),
  ]);

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
      instructionsDoc: section.instructionsDoc ?? null,
      passageText: section.passageText ?? null,
      passageDoc: section.passageDoc ?? null,
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
    bannerUrl: exam.bannerUrl ?? null,
    durationMinutes: exam.durationMinutes,
    status: exam.status,
    kind: exam.kind ?? "mock",
    scoringMode:
      (exam.kind ?? "mock") === "practice"
        ? "raw"
        : exam.scoringMode ?? "band",
    bandConversion: exam.kind === "practice" ? undefined : exam.bandConversion,
    disableTextSelection: exam.disableTextSelection ?? false,
    bandConversionDefaults: {
      listening: defaultThresholdsForSkill("listening"),
      readingAcademic: defaultThresholdsForSkill("reading", "academic"),
      readingGeneral: defaultThresholdsForSkill("reading", "general"),
    },
    curriculum: exam.curriculum,
    postSubmissionResources: exam.postSubmissionResources,
    openAt: exam.openAt ?? null,
    closeAt: exam.closeAt ?? null,
    hasAttempts: Boolean(hasAttempts),
    hasAssignments: Boolean(hasAssignments),
    sections,
    type: exam.kind ?? "mock",
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

  const newKind = data.kind ?? data.type;
  if (newKind !== undefined && newKind !== exam.kind) {
    const [hasAssignment, hasAttempt] = await Promise.all([
      AssignmentModel.exists({ examId: exam._id }),
      AttemptModel.exists({ examId: exam._id }),
    ]);
    if (hasAssignment || hasAttempt) {
      throw new BadRequestError(
        "EXAM_KIND_IMMUTABLE",
        "Không thể thay đổi loại đề thi sau khi đã có bài tập hoặc lượt làm bài."
      );
    }
    exam.kind = newKind;
  }
  if (data.title !== undefined) exam.title = data.title;
  if (data.description !== undefined) exam.description = data.description ?? undefined;
  if (data.bannerUrl !== undefined) exam.bannerUrl = data.bannerUrl ?? undefined;
  if (data.disableTextSelection !== undefined) {
    exam.disableTextSelection = data.disableTextSelection;
  }
  if (
    data.scoringMode !== undefined ||
    data.bandConversion !== undefined ||
    (newKind !== undefined && newKind !== exam.kind)
  ) {
    const nextKind = newKind ?? exam.kind;
    const nextScoringMode: ExamScoringMode =
      nextKind === "practice" ? "raw" : data.scoringMode ?? exam.scoringMode ?? "band";
    const nextBandConversion =
      nextKind === "mock" && nextScoringMode === "band"
        ? data.bandConversion !== undefined
          ? mapBandConversionInput(data.bandConversion) ?? normalizeBandConversion()
          : normalizeBandConversion(exam.bandConversion)
        : undefined;
    const scoringConfigChanged =
      nextScoringMode !== exam.scoringMode ||
      !sameBandConversion(nextBandConversion, exam.bandConversion);

    if (scoringConfigChanged) {
      const hasAttempt = await AttemptModel.exists({ examId: exam._id });
      if (hasAttempt) {
        throw new BadRequestError(
          "EXAM_SCORING_MODE_IMMUTABLE",
          "Không thể thay đổi cách chấm điểm sau khi đã có lượt làm bài."
        );
      }
    }

    exam.scoringMode = nextScoringMode;
    exam.bandConversion = nextBandConversion;
  }
  if (data.curriculum !== undefined) exam.curriculum = mapCurriculumInput(data.curriculum);
  if (data.postSubmissionResources !== undefined) exam.postSubmissionResources = mapResourcesInput(data.postSubmissionResources);
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

  const newKind = data.kind ?? data.type;
  if (newKind !== undefined && newKind !== exam.kind) {
    if (exam.status !== "draft") {
      throw new BadRequestError(
        "EXAM_KIND_IMMUTABLE",
        "Không thể thay đổi loại đề thi sau khi đã xuất bản."
      );
    }
    const [hasAssignment, hasAttempt] = await Promise.all([
      AssignmentModel.exists({ examId: exam._id }),
      AttemptModel.exists({ examId: exam._id }),
    ]);
    if (hasAssignment || hasAttempt) {
      throw new BadRequestError(
        "EXAM_KIND_IMMUTABLE",
        "Không thể thay đổi loại đề thi sau khi đã có bài tập hoặc lượt làm bài."
      );
    }
    exam.kind = newKind;
  }
  if (data.title !== undefined) exam.title = data.title;
  if (data.description !== undefined) exam.description = data.description ?? undefined;
  if (data.bannerUrl !== undefined) exam.bannerUrl = data.bannerUrl ?? undefined;
  if (data.disableTextSelection !== undefined) {
    exam.disableTextSelection = data.disableTextSelection;
  }
  if (
    data.scoringMode !== undefined ||
    data.bandConversion !== undefined ||
    (newKind !== undefined && newKind !== exam.kind)
  ) {
    const nextKind = newKind ?? exam.kind;
    const nextScoringMode: ExamScoringMode =
      nextKind === "practice" ? "raw" : data.scoringMode ?? exam.scoringMode ?? "band";
    const nextBandConversion =
      nextKind === "mock" && nextScoringMode === "band"
        ? data.bandConversion !== undefined
          ? mapBandConversionInput(data.bandConversion) ?? normalizeBandConversion()
          : normalizeBandConversion(exam.bandConversion)
        : undefined;
    const scoringConfigChanged =
      nextScoringMode !== exam.scoringMode ||
      !sameBandConversion(nextBandConversion, exam.bandConversion);

    if (scoringConfigChanged) {
      const hasAttempt = await AttemptModel.exists({ examId: exam._id });
      if (hasAttempt) {
        throw new BadRequestError(
          "EXAM_SCORING_MODE_IMMUTABLE",
          "Không thể thay đổi cách chấm điểm sau khi đã có lượt làm bài."
        );
      }
    }

    exam.scoringMode = nextScoringMode;
    exam.bandConversion = nextBandConversion;
  }
  if (data.curriculum !== undefined) exam.curriculum = mapCurriculumInput(data.curriculum);
  if (data.postSubmissionResources !== undefined) exam.postSubmissionResources = mapResourcesInput(data.postSubmissionResources);
  if (data.openAt !== undefined) exam.openAt = data.openAt ? new Date(data.openAt) : undefined;
  if (data.closeAt !== undefined) exam.closeAt = data.closeAt ? new Date(data.closeAt) : undefined;

  await exam.save();
}

/** Allow updating postSubmissionResources even on published/closed exams */
export async function updateResources(
  id: string,
  data: UpdateExamResourcesBody,
  userId: string,
  role: string
): Promise<IExamPostSubmissionResources | null> {
  const exam = await findOwnedExam(id, userId, role);

  const currentResources = exam.postSubmissionResources ?? {};

  const updatedResources: IExamPostSubmissionResources = {
    solutionVideoUrl: data.solutionVideoUrl !== undefined ? (data.solutionVideoUrl ?? undefined) : currentResources.solutionVideoUrl,
    solutionDocumentUrl: data.solutionDocumentUrl !== undefined ? (data.solutionDocumentUrl ?? undefined) : currentResources.solutionDocumentUrl,
    solutionNotes: data.solutionNotes !== undefined ? (data.solutionNotes ?? undefined) : currentResources.solutionNotes,
    vocabularyItems: data.vocabularyItems !== undefined ? (data.vocabularyItems ? data.vocabularyItems.map((v) => ({
      word: v.word,
      phonetic: v.phonetic ?? undefined,
      meaning: v.meaning,
      contextSentence: v.contextSentence ?? undefined,
    })) : []) : currentResources.vocabularyItems,
  };

  exam.postSubmissionResources = updatedResources;
  await exam.save();

  return exam.postSubmissionResources ?? null;
}

/** Allow updating curriculum metadata */
export async function updateCurriculum(
  id: string,
  data: UpdateExamCurriculumBody,
  userId: string,
  role: string
): Promise<IExamCurriculum | null> {
  const exam = await findOwnedExam(id, userId, role);

  exam.curriculum = mapCurriculumInput(data);
  await exam.save();

  return exam.curriculum ?? null;
}

export async function remove(id: string, userId: string, role: string): Promise<void> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status === "published") {
    throw new BadRequestError(
      "EXAM_CANNOT_EDIT_PUBLISHED",
      "Đề đã xuất bản không thể xoá trực tiếp. Hãy dùng “Sửa” để chuyển về nháp trước."
    );
  }

  const [hasAttempt, hasAssignment] = await Promise.all([
    AttemptModel.exists({ examId: exam._id }),
    AssignmentModel.exists({ examId: exam._id }),
  ]);

  if (hasAttempt) {
    throw new BadRequestError(
      "EXAM_HAS_ATTEMPTS",
      "Không thể xoá đề đã có học sinh làm bài."
    );
  }

  if (hasAssignment) {
    throw new BadRequestError(
      "EXAM_HAS_ASSIGNMENTS",
      "Không thể xoá đề đã được giao cho lớp."
    );
  }

  await ExamModel.deleteOne({ _id: exam._id });
}

/**
 * Reopen a closed exam. Reuses the publish validation so an exam can never be
 * reopened in a state that could not have been published. A `closeAt` in the
 * past is cleared, otherwise the exam would be "open" but still blocked.
 */
export async function reopen(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus; clearedCloseAt?: boolean }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status !== "closed") {
    throw new BadRequestError(
      "EXAM_NOT_CLOSED",
      "Chỉ có thể mở lại đề thi đang ở trạng thái đã đóng."
    );
  }

  const originalCloseAt = exam.closeAt;
  const hadPastCloseAt = Boolean(
    originalCloseAt && originalCloseAt.getTime() <= Date.now()
  );

  if (hadPastCloseAt) {
    exam.closeAt = undefined;
    await exam.save();
  }

  try {
    const result = await publish(id, userId, role);
    return hadPastCloseAt ? { ...result, clearedCloseAt: true } : result;
  } catch (error) {
    if (hadPastCloseAt) {
      exam.closeAt = originalCloseAt;
      await exam.save();
    }
    throw error;
  }
}

/**
 * Convert a published/closed exam back to draft so its content can be edited
 * again. Exams that already have attempts are rejected: editing them would
 * change the exam students were graded against (the UI offers clone-to-edit).
 */
export async function convertToDraft(
  id: string,
  userId: string,
  role: string
): Promise<{ id: string; status: ExamStatus; clearedCloseAt?: boolean }> {
  const exam = await findOwnedExam(id, userId, role);

  if (exam.status === "draft") {
    return { id: exam._id.toString(), status: exam.status };
  }

  const hasAttempt = await AttemptModel.exists({ examId: exam._id });
  if (hasAttempt) {
    throw new BadRequestError(
      "EXAM_HAS_ATTEMPTS",
      "Đề đã có học sinh làm bài. Hãy nhân bản đề để chỉnh sửa."
    );
  }

  // A closed exam normally has a past `closeAt`. Keeping it would silently
  // block students again right after the teacher re-publishes the draft.
  const hadPastCloseAt = Boolean(
    exam.closeAt && exam.closeAt.getTime() <= Date.now()
  );
  if (hadPastCloseAt) exam.closeAt = undefined;

  exam.status = "draft";
  await exam.save();

  return {
    id: exam._id.toString(),
    status: exam.status,
    ...(hadPastCloseAt ? { clearedCloseAt: true } : {}),
  };
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

  const clonedKind = original.kind ?? "mock";
  const clonedScoringMode: ExamScoringMode =
    clonedKind === "practice" ? "raw" : original.scoringMode ?? "band";

  const cloned = await ExamModel.create({
    title: `[Bản sao] ${original.title}`,
    description: original.description,
    kind: clonedKind,
    scoringMode: clonedScoringMode,
    bandConversion:
      clonedKind === "mock" && clonedScoringMode === "band"
        ? normalizeBandConversion(original.bandConversion)
        : undefined,
    disableTextSelection: original.disableTextSelection ?? false,
    curriculum: original.curriculum,
    postSubmissionResources: original.postSubmissionResources,
    durationMinutes: original.durationMinutes,
    sections: original.sections.map((section) => ({
      skill: section.skill,
      part: section.part,
      title: section.title,
      instructions: section.instructions,
      instructionsDoc: section.instructionsDoc,
      passageText: section.passageText,
      passageDoc: section.passageDoc,
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
export function countExamQuestions(exam: Pick<IExam, "sections">): number {
  let count = 0;
  for (const section of exam.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      count += (group.questions ?? []).length;
    }
  }
  return count;
}

/** Count total points across all questions (including weights). */
export function countExamPoints(exam: Pick<IExam, "sections">): number {
  let count = 0;
  for (const section of exam.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      for (const question of group.questions ?? []) {
        count += question.points ?? 1;
      }
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

  // Specific validation for practice: allow single or multiple parts
  if (exam.kind === "practice") {
    if (!exam.sections || exam.sections.length === 0) {
      throw new BadRequestError(
        "PRACTICE_MUST_HAVE_SECTIONS",
        "Bài luyện tập phải có ít nhất 1 phần thi (section)."
      );
    }

    for (const practiceSection of exam.sections) {
      if (practiceSection.skill !== "listening" && practiceSection.skill !== "reading") {
        throw new BadRequestError(
          "PRACTICE_INVALID_SKILL",
          "Bài luyện tập chỉ hỗ trợ kỹ năng Listening hoặc Reading."
        );
      }
    }

    if (
      exam.curriculum?.part !== undefined &&
      exam.sections.length === 1 &&
      exam.sections[0].part !== undefined &&
      exam.curriculum.part !== exam.sections[0].part
    ) {
      throw new BadRequestError(
        "CURRICULUM_PART_MISMATCH",
        `Phần curriculum.part (${exam.curriculum.part}) phải khớp với phần thi (${exam.sections[0].part}).`
      );
    }
  }

  if (exam.kind === "practice") {
    exam.scoringMode = "raw";
    exam.bandConversion = undefined;
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

        const configuredMaxWords = (group.config as { maxWords?: unknown } | undefined)?.maxWords;
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

  // Listening/reading point check
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

    if (sectionPoints > 0 && sectionPoints !== 40 && exam.kind !== "practice") {
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
