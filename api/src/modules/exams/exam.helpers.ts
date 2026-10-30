import mongoose, { type Types } from "mongoose";
import { BadRequestError, ForbiddenError } from "../../common/errors/AppError.js";
import { mediaKeyFromUrl, publicObjectUrl } from "../../config/minio.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import type { QuestionGroupType, SkillType } from "../questions/question.model.js";
import { normalizeExamSectionNumbering } from "./exam-numbering.js";
import { logger } from "../../common/utils/logger.js";
import {
  getGroupConfigImageId,
  shouldEnforceWordLimit,
  type CandidateExam,
  type CandidateMediaItem,
} from "../attempts/attempt.service.js";

export type { CandidateMediaItem, CandidateExam };
import {
  normalizeBandConversion,
  validateBandConversion,
} from "../../common/utils/band-conversion.js";
import type {
  BandConversionInput,
  CurriculumInput,
  ExamSectionInput,
  PostSubmissionResourcesInput,
  QuestionGroupInput,
  QuestionItemInput,
} from "./exam.validation.js";
import type {
  ExamKind,
  ExamScoringMode,
  ExamStatus,
  IBandConversion,
  IExam,
  IExamCurriculum,
  IExamPostSubmissionResources,
  IExamSection,
  IQuestionGroup,
  IQuestionItem,
  RichDocValue,
} from "./exam.model.js";

/**
 * Normalise a stored banner URL to the permanent public object URL.
 */
export function normalizeBannerUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const key = mediaKeyFromUrl(trimmed);
  return key ? publicObjectUrl(key)! : trimmed;
}

/** Value to persist when a banner is set: never store a signed URL. */
export function toStoredBannerUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return normalizeBannerUrl(url) ?? undefined;
}

const SKILL_ORDER: SkillType[] = ["listening", "reading", "writing"];

/** Distinct skills of an exam's sections, deduplicated and sorted IELTS-style. */
export function collectExamSkills(
  sections: Array<{ skill?: string | null }> | undefined | null
): SkillType[] {
  const present = new Set(
    (sections ?? [])
      .map((section) => section.skill)
      .filter((skill): skill is SkillType => SKILL_ORDER.includes(skill as SkillType))
  );
  return SKILL_ORDER.filter((skill) => present.has(skill));
}

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
  skills: SkillType[];
  createdAt: Date;
  type?: ExamKind;
  hasAttempts?: boolean;
  hasAssignments?: boolean;
  attemptsCount?: number;
  activeAttemptsCount?: number;
  contentRevision?: number;
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
  hasAttempts?: boolean;
  hasAssignments?: boolean;
  attemptsCount?: number;
  activeAttemptsCount?: number;
  contentRevision: number;
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

export type ExamListSort =
  | "date_desc"
  | "date_asc"
  | "title_asc"
  | "title_desc"
  | "collection_asc";

export interface ListExamsFilters {
  status?: ExamStatus;
  kind?: ExamKind;
  type?: ExamKind;
  skill?: SkillType;
  collectionName?: string;
  search?: string;
  sort?: ExamListSort;
  page: number;
  limit: number;
}

export const EXAM_LIST_SORTS: Record<ExamListSort, Record<string, 1 | -1>> = {
  date_desc: { createdAt: -1 },
  date_asc: { createdAt: 1 },
  title_asc: { title: 1, createdAt: -1 },
  title_desc: { title: -1, createdAt: -1 },
  collection_asc: {
    "curriculum.collectionName": 1,
    "curriculum.testNumber": 1,
    "curriculum.part": 1,
    title: 1,
  },
};

const naturalTitleCollator = new Intl.Collator("vi", {
  numeric: true,
  sensitivity: "base",
});

/** Natural title comparison ("CAM 8" < "CAM 9" < "CAM 10"). */
export function compareExamTitles(a: string, b: string): number {
  return naturalTitleCollator.compare(a, b);
}

/** Filter for a book group / curriculum collection. */
export function buildCollectionFilter(collectionName: string): Record<string, unknown> {
  const value = collectionName.trim();
  const normalized = value.toLowerCase();

  let matcher: RegExp;
  if (normalized === "cambridge") {
    matcher = /\bcam(?:bridge)?\b/i;
  } else if (normalized === "vol") {
    matcher = /\bvol(?:ume)?\b/i;
  } else if (normalized === "road to ielts") {
    matcher = /road\s*to\s*ielts/i;
  } else {
    matcher = new RegExp(escapeRegExp(value), "i");
  }

  return {
    $or: [{ "curriculum.collectionName": matcher }, { title: matcher }],
  };
}

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

/** Check if a section uses questionGroups */
export function sectionUsesGroups(section: IExamSection): boolean {
  return Array.isArray(section.questionGroups) && section.questionGroups.length > 0;
}

export function toSafeObjectId(id: unknown): Types.ObjectId | undefined {
  if (!id) return undefined;
  const str = String(id).trim();
  if (mongoose.Types.ObjectId.isValid(str) && /^[0-9a-fA-F]{24}$/.test(str)) {
    return new mongoose.Types.ObjectId(str);
  }
  return undefined;
}

export function extractMediaId(item: unknown): string {
  if (item === null || item === undefined) return "";
  if (typeof item === "object" && "_id" in item) {
    const id = (item as { _id?: unknown })._id;
    return id ? String(id) : "";
  }
  return String(item);
}

export function mapQuestionItemInput(item: QuestionItemInput): Partial<IQuestionItem> {
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

export function mapQuestionGroupInput(group: QuestionGroupInput): Partial<IQuestionGroup> {
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
  const mapped = sections.map((section) => {
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

  return normalizeExamSectionNumbering(mapped).sections;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function examContentSignature(sections: IExamSection[] | undefined): string {
  const normalized = normalizeExamSectionNumbering(sections ?? []).sections;
  return stableStringify(
    normalized.map((section) => ({
      id: section._id?.toString() ?? null,
      skill: section.skill,
      part: section.part,
      title: section.title ?? "",
      instructions: section.instructions ?? "",
      instructionsDoc: section.instructionsDoc ?? null,
      passageText: section.passageText ?? "",
      passageDoc: section.passageDoc ?? null,
      transcript: section.transcript ?? "",
      mediaIds: (section.mediaIds ?? []).map(extractMediaId).sort(),
      questionGroups: (section.questionGroups ?? []).map((group) => ({
        id: group._id?.toString() ?? null,
        groupType: group.groupType,
        instructions: group.instructions ?? "",
        instructionsDoc: group.instructionsDoc ?? null,
        config: group.config ?? {},
        questions: (group.questions ?? []).map((question) => ({
          id: question._id?.toString() ?? null,
          questionNumber: question.questionNumber,
          prompt: question.prompt ?? "",
          promptDoc: question.promptDoc ?? null,
          acceptedAnswers: question.acceptedAnswers ?? [],
          points: question.points ?? 1,
          explanation: question.explanation ?? null,
          mediaIds: (question.mediaIds ?? []).map(extractMediaId).sort(),
        })),
      })),
    }))
  );
}

export function serializeQuestionItem(item: IQuestionItem): SerializedQuestionItem {
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

export function serializeQuestionGroup(
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

export function mapCurriculumInput(curriculum?: CurriculumInput | null): IExamCurriculum | undefined {
  if (!curriculum) return undefined;
  return {
    collectionName: curriculum.collectionName ?? undefined,
    testNumber: curriculum.testNumber ?? undefined,
    part: curriculum.part ?? curriculum.partOrPassage ?? undefined,
    orderIndex: curriculum.orderIndex ?? undefined,
  };
}

export function mapResourcesInput(resources?: PostSubmissionResourcesInput | null): IExamPostSubmissionResources | undefined {
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

export function mapBandConversionInput(
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

export function sameBandConversion(
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

export function countExamQuestions(exam: Pick<IExam, "sections">): number {
  let count = 0;
  for (const section of exam.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      count += (group.questions ?? []).length;
    }
  }
  return count;
}

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

export function validateExamReadyForPublish(exam: IExam): void {
  // Heal legacy drafts on publish: numbering is part of the candidate contract.
  const normalized = normalizeExamSectionNumbering(exam.sections);
  if (normalized.changed) exam.sections = normalized.sections;

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

    const curriculumSection = exam.sections[0];
    if (
      exam.curriculum?.part !== undefined &&
      exam.sections.length === 1 &&
      curriculumSection.part !== undefined &&
      curriculumSection.skill !== "writing" &&
      exam.curriculum.part !== curriculumSection.part
    ) {
      throw new BadRequestError(
        "CURRICULUM_PART_MISMATCH",
        `Phần curriculum.part (${exam.curriculum.part}) phải khớp với phần thi (${curriculumSection.part}).`
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
}
