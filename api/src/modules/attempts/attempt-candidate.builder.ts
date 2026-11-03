import mongoose, { type Types } from "mongoose";
import { env } from "../../config/env.js";
import { logger } from "../../common/utils/logger.js";
import { extractMediaId } from "../../common/utils/media.util.js";
import { presignGetObject } from "../../config/minio.js";
import { MediaModel } from "../media/media.model.js";
import {
  type IExam,
  type IQuestionGroup,
  type ExamKind,
} from "../exams/exam.model.js";
import { normalizeExamSectionNumbering } from "../exams/exam-numbering.js";
import type {
  CandidateExam,
  CandidateExamSection,
  CandidateMediaItem,
  CandidateQuestionGroup,
  RawExamObject,
  RawPopulatedSection,
} from "./attempt.types.js";

/** TTL for media that is not tied to a live exam (avatars, media library). */
export const DEFAULT_MEDIA_PRESIGN_TTL_SECONDS = 15 * 60;

export function toCandidateMediaItem(
  item: unknown,
  urlMap?: Map<string, string>
): CandidateMediaItem | null {
  if (
    typeof item === "object" &&
    item !== null &&
    "_id" in item &&
    "key" in item &&
    "type" in item
  ) {
    const mediaDoc = item as {
      _id: Types.ObjectId | string;
      key: string;
      type: "audio" | "image";
      originalName?: string;
    };
    const id = mediaDoc._id.toString();
    const presigned = urlMap?.get(id);
    return {
      id,
      url: presigned ?? `${env.PUBLIC_MEDIA_URL}/${mediaDoc.key}`,
      type: mediaDoc.type,
      originalName: mediaDoc.originalName ?? "",
    };
  }
  return null;
}

/**
 * TTL for exam media: enough to cover the whole attempt plus 6 hours of slack,
 * so an image/audio URL stays valid from start to (grace-period) submit and
 * across a mobile tab being backgrounded or briefly losing network.
 */
export function examMediaPresignTtl(durationMinutes: number): number {
  return durationMinutes * 60 + 6 * 3600;
}

/**
 * Read a usable media ObjectId from a question group's `config.imageMediaId`.
 *
 * The id is stored as a plain string inside a Mixed config, so validate the
 * 24-hex shape explicitly (mongoose's isValid would also accept 12-char ids).
 */
export function getGroupConfigImageId(
  group: { config?: Record<string, unknown> } | null | undefined
): string | undefined {
  const raw = group?.config?.imageMediaId;
  if (typeof raw !== "string") return undefined;
  const str = raw.trim();
  return /^[0-9a-fA-F]{24}$/.test(str) ? str : undefined;
}

/** Collect every media ObjectId referenced by an exam (all formats). */
export function collectExamMediaIds(exam: IExam): string[] {
  const maybeToObject = exam as unknown as { toObject?: () => unknown };
  const examObj = (
    typeof maybeToObject.toObject === "function"
      ? maybeToObject.toObject()
      : exam
  ) as RawExamObject & {
    sections?: Array<RawPopulatedSection & { questionGroups?: IQuestionGroup[] }>;
  };
  const ids = new Set<string>();

  for (const section of examObj.sections ?? []) {
    for (const media of section.mediaIds ?? []) {
      const id = extractMediaId(media);
      if (mongoose.Types.ObjectId.isValid(id)) ids.add(id);
    }

    for (const group of section.questionGroups ?? []) {
      const configImageId = getGroupConfigImageId(group);
      if (configImageId) ids.add(configImageId);

      for (const question of group.questions ?? []) {
        for (const media of question.mediaIds ?? []) {
          const id = extractMediaId(media);
          if (mongoose.Types.ObjectId.isValid(id)) ids.add(id);
        }
      }
    }
  }

  return [...ids];
}

/**
 * Resolve presigned GET URLs for every media in the exam, keyed by media id.
 * Missing/unpresignable media are simply absent from the map (the caller then
 * falls back to the legacy static URL).
 */
export async function presignMediaMap(
  exam: IExam,
  ttlSeconds: number
): Promise<Map<string, string>> {
  const ids = collectExamMediaIds(exam);
  const urlMap = new Map<string, string>();

  if (ids.length === 0) return urlMap;

  const mediaDocs = await MediaModel.find({ _id: { $in: ids } }).select("key");

  await Promise.all(
    mediaDocs.map(async (doc) => {
      const key = (doc as unknown as { key?: string }).key;
      if (!key) return;
      const url = await presignGetObject(key, ttlSeconds);
      if (url) {
        urlMap.set(doc._id.toString(), url);
      } else {
        logger.warn("media.presign_failed", { mediaId: doc._id.toString(), key });
      }
    })
  );

  return urlMap;
}

export function computeRemainingSeconds(
  expiresAt: Date,
  now: number = Date.now()
): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
}

/** Collect all question IDs from a candidate exam. */
export function collectCandidateQuestionIds(exam: CandidateExam): string[] {
  return exam.sections.flatMap((section) =>
    (section.questionGroups ?? []).flatMap((group) => group.questions.map((q) => q.id))
  );
}

export function shuffleQuestionIds(questionIds: string[], seed: number): string[] {
  const result = [...questionIds];
  let state = seed >>> 0 || 1;

  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

export function applyQuestionOrder(exam: CandidateExam, order: string[]): CandidateExam {
  if (order.length === 0) return exam;

  const position = new Map(order.map((id, index) => [id, index]));

  const sortByIdPosition = <T extends { id: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => {
      const positionA = position.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const positionB = position.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return positionA - positionB;
    });

  return {
    ...exam,
    sections: exam.sections.map((section) => ({
      ...section,
      questionGroups: (section.questionGroups ?? []).map((group) => ({
        ...group,
        questions: sortByIdPosition(group.questions),
      })),
    })),
  };
}

/**
 * FIX-18: display-relevant config keys that are safe to expose to candidates.
 * Everything else (including any future answer-key-like fields) is dropped.
 */
export const GROUP_CONFIG_WHITELIST = new Set<string>([
  "options",
  "maxSelections",
  "headingsPool",
  "paragraphLabels",
  "featuresPool",
  "endingsPool",
  "allowReuse",
  "allowChangeAnswer",
  "template",
  "maxWords",
  "allowNumbers",
  "wordLimitText",
  "optionsPool",
  "imageMediaId",
  "labels",
  "minWords",
  "sampleAnswer",
  "bandDescriptors",
  "topics",
  "cueCard",
  "bulletPoints",
  "prepTimeSeconds",
  "speakTimeSeconds",
  "questions",
]);

export function stripGroupConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(config)) {
    if (GROUP_CONFIG_WHITELIST.has(key)) {
      safe[key] = config[key];
    }
  }
  return safe;
}

/**
 * Whitelist-serializes a populated exam for the candidate, guaranteeing that
 * `acceptedAnswers` and `explanation` can never leak.
 */
export function buildCandidateExam(
  exam: IExam,
  urlMap?: Map<string, string>
): CandidateExam {
  const examObj = exam.toObject() as unknown as RawExamObject;
  const normalizedSections = normalizeExamSectionNumbering(
    examObj.sections ?? []
  ).sections;

  return {
    id: examObj._id.toString(),
    title: examObj.title,
    kind: (exam.kind ?? "mock") as ExamKind,
    scoringMode:
      exam.scoringMode ?? (exam.kind === "practice" ? "raw" : "band"),
    disableTextSelection: exam.disableTextSelection ?? false,
    sections: normalizedSections.map((section: RawPopulatedSection): CandidateExamSection => {
      const sectionMedia = (section.mediaIds ?? [])
        .map((item) => toCandidateMediaItem(item, urlMap))
        .filter((m): m is CandidateMediaItem => m !== null);
      const sectionMediaIds = (section.mediaIds ?? []).map(extractMediaId);

      const candidateGroups: CandidateQuestionGroup[] = (section.questionGroups ?? []).map(
        (group) => {
          const groupImageId = getGroupConfigImageId(group);
          const groupImageUrl = groupImageId ? urlMap?.get(groupImageId) : undefined;
          const groupMedia: CandidateMediaItem[] =
            groupImageId && groupImageUrl
              ? [{ id: groupImageId, url: groupImageUrl, type: "image", originalName: "" }]
              : [];

          return {
            id: group._id?.toString() ?? "",
            groupType: group.groupType,
            instructions: group.instructions ?? "",
            instructionsDoc: group.instructionsDoc ?? null,
            config: stripGroupConfig(group.config ?? {}),
            media: groupMedia,
            questions: (group.questions ?? []).map((q) => {
              const qMedia = (q.mediaIds ?? [])
                .map((item) => toCandidateMediaItem(item, urlMap))
                .filter((m): m is CandidateMediaItem => m !== null);
              const qMediaIds = (q.mediaIds ?? []).map(extractMediaId);
              return {
                id: q._id?.toString() ?? "",
                questionNumber: q.questionNumber,
                prompt: q.prompt ?? "",
                promptDoc: q.promptDoc ?? null,
                points: q.points ?? 1,
                mediaIds: qMediaIds,
                media: qMedia,
              };
            }),
          };
        }
      );

      return {
        id: section._id?.toString() ?? "",
        skill: section.skill,
        part: section.part,
        title: section.title,
        instructions: section.instructions ?? null,
        instructionsDoc: section.instructionsDoc ?? null,
        passageText: section.passageText ?? null,
        passageDoc: section.passageDoc ?? null,
        transcript: section.transcript ?? null,
        mediaIds: sectionMediaIds,
        media: sectionMedia,
        questionGroups: candidateGroups,
      };
    }),
  };
}
