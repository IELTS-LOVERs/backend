import mongoose, { type Types } from "mongoose";
import { extractMediaId } from "../../common/utils/media.util.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import { BadRequestError } from "../../common/errors/AppError.js";
import {
  normalizeBandConversion,
  validateBandConversion,
} from "../../common/utils/band-conversion.js";
import { getGroupConfigImageId } from "../attempts/attempt.service.js";
import type { CandidateMediaItem } from "../attempts/attempt.types.js";
import { mediaKeyFromUrl, publicObjectUrl } from "../../config/minio.js";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";
import { normalizeExamSectionNumbering } from "./exam-numbering.js";
import type {
  ExamKind,
  ExamScoringMode,
  IBandConversion,
  IExamCurriculum,
  IExamPostSubmissionResources,
  IExamSection,
  IQuestionGroup,
  IQuestionItem,
} from "./exam.model.js";
import type {
  BandConversionInput,
  CurriculumInput,
  ExamSectionInput,
  PostSubmissionResourcesInput,
  QuestionGroupInput,
  QuestionItemInput,
} from "./exam.validation.js";
import type {
  SerializedQuestionGroup,
  SerializedQuestionItem,
} from "./exam.types.js";

/**
 * Normalise a stored banner URL to the permanent public object URL.
 *
 * Older banners were saved with the media-library value, which was a presigned
 * URL with a 15-minute TTL — after that the practice cards got 403 (broken
 * image). Rewriting the key here fixes existing rows at read time without a
 * migration, while external URLs (Unsplash, …) pass through untouched.
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

export const SKILL_ORDER: SkillType[] = ["listening", "reading", "writing"];

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

const naturalTitleCollator = new Intl.Collator("vi", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Natural title comparison so "CAM 8" sorts before "CAM 9" and "CAM 10"
 * instead of Mongo's lexicographic "CAM 10" < "CAM 8".
 */
export function compareExamTitles(a: string, b: string): number {
  return naturalTitleCollator.compare(a, b);
}

/**
 * Filter for a book group / curriculum collection.
 *
 * Known groups match their common aliases ("Cam 8", "Cambridge IELTS 18",
 * "Vol 2", "Road to IELTS"). Any other collection name matches literally on
 * either `curriculum.collectionName` or the exam title, so legacy exams that
 * only have the book name in their title still show up.
 */
export function buildCollectionFilter(
  collectionName: string
): Record<string, unknown> {
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

export function toSafeObjectId(id: unknown): Types.ObjectId | undefined {
  if (!id) return undefined;
  const str = String(id).trim();
  if (mongoose.Types.ObjectId.isValid(str) && /^[0-9a-fA-F]{24}$/.test(str)) {
    return new mongoose.Types.ObjectId(str);
  }
  return undefined;
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

/**
 * Deterministic JSON with sorted object keys.
 */
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

/**
 * Stable signature of the *candidate-visible* exam content.
 */
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
