import crypto from "crypto";
import mongoose, { type Types } from "mongoose";
import { EXAM_GRACE_PERIOD_SECONDS } from "../../config/constants.js";
import { env } from "../../config/env.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { resolveBandScore } from "../../common/utils/band-conversion.js";
import { calculateOverallBand } from "../../common/utils/ielts-calculator.js";
import { logger } from "../../common/utils/logger.js";
import { matchAnswer } from "../../common/utils/string-normalizer.js";
import { AssignmentModel, type IAssignment } from "../assignments/assignment.model.js";
import { ClassModel } from "../classes/class.model.js";
import {
  ExamModel,
  type ExamKind,
  type IBandConversion,
  type IExam,
  type IQuestionGroup,
  type IExamPostSubmissionResources,
} from "../exams/exam.model.js";
import { assertTeacherOwnsAttempt } from "../grading/grading.service.js";
import { WritingReviewModel } from "../grading/writing-review.model.js";
import "../questions/question.model.js";
import { MediaModel } from "../media/media.model.js";
import { presignGetObject } from "../../config/minio.js";
import type { SkillType, QuestionGroupType } from "../questions/question.model.js";
import {
  AttemptModel,
  type AttemptStatus,
  type IAttempt,
  type IAttemptAnswer,
  type IAttemptScores,
} from "./attempt.model.js";
import type { GetMyAttemptsQuery } from "./attempt.validation.js";

export interface CandidateMediaItem {
  id: string;
  url: string;
  type: "audio" | "image";
  originalName: string;
}

export interface CandidateQuestionItem {
  id: string;
  questionNumber: number;
  prompt: string;
  points: number;
  mediaIds: string[];
  media: CandidateMediaItem[];
}

export interface CandidateQuestionGroup {
  id: string;
  groupType: QuestionGroupType;
  instructions: string;
  config: Record<string, unknown>;
  /** Resolved group-level image (config.imageMediaId) with a presigned URL. */
  media: CandidateMediaItem[];
  questions: CandidateQuestionItem[];
}

export interface CandidateExamSection {
  id: string;
  skill: SkillType;
  part: number;
  title: string;
  instructions: string | null;
  passageText: string | null;
  transcript: string | null;
  mediaIds: string[];
  media: CandidateMediaItem[];
  questionGroups: CandidateQuestionGroup[];
}

export interface CandidateExam {
  id: string;
  title: string;
  kind: ExamKind;
  scoringMode?: "band" | "raw";
  sections: CandidateExamSection[];
}

export interface StartAttemptResult {
  attemptId: string;
  examId: string;
  startedAt: Date;
  expiresAt: Date;
  remainingSeconds: number;
  status: AttemptStatus;
  exam: CandidateExam;
}

export interface RecoveryAnswer {
  questionId: string;
  value: string;
}

export interface AttemptRecoveryResult {
  attemptId: string;
  status: AttemptStatus;
  remainingSeconds: number;
  answers: RecoveryAnswer[];
  exam: CandidateExam;
}

export interface AutosaveResult {
  savedCount: number;
  serverRemainingSeconds: number;
}

export interface SubmitAttemptResult {
  attemptId: string;
  status: AttemptStatus;
  submittedAt: Date;
  scores: IAttemptScores;
  message?: string;
}

export interface ResultQuestionDetail {
  questionId: string;
  questionNumber?: number;
  groupType?: string;
  studentAnswer: string | null;
  acceptedAnswers: string[];
  isCorrect: boolean;
  explanation: string | null;
}

export interface AttemptWritingReview {
  id: string;
  attemptId: string;
  task1?: {
    score: number;
    comment: string | null;
  };
  task2?: {
    score: number;
    comment: string | null;
  };
  overallWritingScore: number;
  generalFeedback: string | null;
  teacherId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttemptResult {
  attemptId: string;
  examId: string;
  examTitle?: string;
  examDurationMinutes?: number;
  studentName?: string;
  studentEmail?: string;
  status: AttemptStatus;
  startedAt?: Date;
  submittedAt?: Date;
  durationSeconds?: number;
  scores: IAttemptScores;
  writingReview: AttemptWritingReview | null;
  details: ResultQuestionDetail[];
  postSubmissionResources?: IExamPostSubmissionResources | null;
  examKind?: ExamKind;
  scoreMode?: "band" | "raw";
  questionCount?: number;
  totalPoints?: number;
  rawScore?: number;
  percentage?: number;
  correctCount?: number;
  wrongCount?: number;
  blankCount?: number;
}

export interface RawPopulatedSection {
  _id?: Types.ObjectId;
  skill: SkillType;
  part: number;
  title: string;
  instructions?: string;
  passageText?: string;
  transcript?: string;
  mediaIds?: unknown[];
  questionGroups?: IQuestionGroup[];
}

export interface RawExamObject {
  _id: Types.ObjectId;
  title: string;
  sections?: RawPopulatedSection[];
}

export interface GradableGroupQuestion {
  _id: Types.ObjectId;
  questionNumber: number;
  acceptedAnswers: string[];
  points: number;
  groupConfig: Record<string, unknown>;
  groupType: QuestionGroupType;
}

export interface ExamQuestionBuckets {
  hasListening: boolean;
  hasReading: boolean;
  hasWriting: boolean;
  listeningGrouped: GradableGroupQuestion[];
  readingGrouped: GradableGroupQuestion[];
}

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
    // FIX-02: prefer a short-lived presigned GET URL. Fall back to the legacy
    // static public URL only when presigning was unavailable, so the exam UI
    // still renders instead of breaking outright.
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

/** TTL for media that is not tied to a live exam (avatars, media library). */
export const DEFAULT_MEDIA_PRESIGN_TTL_SECONDS = 15 * 60;

/**
 * TTL for exam media: enough to cover the whole attempt plus 30 minutes of
 * slack, so an `<audio>` URL stays valid from start to (grace-period) submit.
 */
export function examMediaPresignTtl(durationMinutes: number): number {
  return durationMinutes * 60 + 1800;
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
      // Group-level image (config.imageMediaId) — resolve its presigned URL too.
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

function extractMediaId(item: unknown): string {
  if (typeof item === "object" && item !== null && "_id" in item) {
    return (item as { _id: Types.ObjectId | string })._id.toString();
  }
  return String(item);
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
      // FIX-09: a shuffled order applies to questions inside each group.
      // Group order itself is preserved — templates like [1][2] are bound to
      // questionNumber, so reordering groups would break the layout.
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

  return {
    id: examObj._id.toString(),
    title: examObj.title,
    kind: (exam.kind ?? "mock") as ExamKind,
    scoringMode:
      exam.scoringMode ?? (exam.kind === "practice" ? "raw" : "band"),
    sections: (examObj.sections ?? []).map((section) => {
      const sectionMedia = (section.mediaIds ?? [])
        .map((item) => toCandidateMediaItem(item, urlMap))
        .filter((m): m is CandidateMediaItem => m !== null);
      const sectionMediaIds = (section.mediaIds ?? []).map(extractMediaId);

      const candidateGroups: CandidateQuestionGroup[] = (section.questionGroups ?? []).map(
        (group) => {
          // Group-level image (config.imageMediaId): expose the presigned URL
          // additively via `media` so the exam engine can render it. The raw id
          // stays inside `config` for the editor round-trip.
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
        passageText: section.passageText ?? null,
        transcript: section.transcript ?? null,
        mediaIds: sectionMediaIds,
        media: sectionMedia,
        questionGroups: candidateGroups,
      };
    }),
  };
}

export function collectExamQuestionBuckets(examObj: RawExamObject): ExamQuestionBuckets {
  const listeningGrouped: GradableGroupQuestion[] = [];
  const readingGrouped: GradableGroupQuestion[] = [];
  let hasListening = false;
  let hasReading = false;
  let hasWriting = false;

  for (const section of examObj.sections ?? []) {
    if (section.skill === "listening") hasListening = true;
    else if (section.skill === "reading") hasReading = true;
    else if (section.skill === "writing") hasWriting = true;

    for (const group of section.questionGroups ?? []) {
      for (const q of group.questions ?? []) {
        const gradable: GradableGroupQuestion = {
          _id: q._id,
          questionNumber: q.questionNumber,
          acceptedAnswers: q.acceptedAnswers ?? [],
          points: q.points ?? 1,
          groupConfig: group.config ?? {},
          groupType: group.groupType,
        };
        if (section.skill === "listening") listeningGrouped.push(gradable);
        else if (section.skill === "reading") readingGrouped.push(gradable);
      }
    }
  }

  return { hasListening, hasReading, hasWriting, listeningGrouped, readingGrouped };
}

/** Group types where a configured word limit actually applies to the answer. */
export const WORD_LIMIT_GROUP_TYPES = new Set<string>([
  "sentence_completion",
  "note_completion",
  "table_completion",
  "summary_completion",
  "summary_completion_options",
  "form_completion",
  "flow_chart_completion",
  "short_answer",
]);

/** FIX-11: only completion/short-answer groups enforce `config.maxWords`. */
export function shouldEnforceWordLimit(groupType: string): boolean {
  return WORD_LIMIT_GROUP_TYPES.has(groupType);
}

/** Check word count for completion-type answers */
function checkWordLimit(answer: string, config: Record<string, unknown>): boolean {
  const maxWords = config.maxWords as number | undefined;
  if (!maxWords) return true;
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  return wordCount <= maxWords;
}

export interface GradeBreakdown {
  rawScore: number;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
}

/** Grade questions and return raw points + correct/wrong/blank counts. */
export function gradeGroupedQuestionsDetailed(
  answers: Pick<IAttemptAnswer, "questionId" | "value">[],
  questions: GradableGroupQuestion[]
): GradeBreakdown {
  const answerByQuestionId = new Map(
    answers.map((answer) => [answer.questionId.toString(), answer.value])
  );
  let rawScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;

  for (const question of questions) {
    const value = answerByQuestionId.get(question._id.toString());

    if (value === undefined || value.trim() === "") {
      blankCount += 1;
      continue;
    }

    // Enforce word limit only for completion/short-answer types (FIX-11)
    if (
      shouldEnforceWordLimit(question.groupType) &&
      !checkWordLimit(value, question.groupConfig)
    ) {
      wrongCount += 1;
      continue; // Over word limit = 0 marks
    }

    if (matchAnswer(value, question.acceptedAnswers)) {
      rawScore += question.points;
      correctCount += 1;
    } else {
      wrongCount += 1;
    }
  }

  return { rawScore, correctCount, wrongCount, blankCount };
}

/** Grade questions from embedded question groups (with word-limit enforcement). */
export function gradeGroupedQuestions(
  answers: Pick<IAttemptAnswer, "questionId" | "value">[],
  questions: GradableGroupQuestion[]
): number {
  return gradeGroupedQuestionsDetailed(answers, questions).rawScore;
}

function serializeScores(scores: IAttemptScores): IAttemptScores {
  return {
    listeningRaw: scores.listeningRaw,
    listeningBand: scores.listeningBand,
    readingRaw: scores.readingRaw,
    readingBand: scores.readingBand,
    writingTask1Band: scores.writingTask1Band,
    writingTask2Band: scores.writingTask2Band,
    writingBand: scores.writingBand,
    overallBand: scores.overallBand,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

async function findOwnedAttempt(attemptId: string, studentId: string): Promise<IAttempt> {
  const attempt = await AttemptModel.findById(attemptId);

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  if (attempt.studentId.toString() !== studentId) {
    throw new ForbiddenError(
      "ATTEMPT_NOT_OWNED",
      "Học sinh không có quyền truy cập bài làm này."
    );
  }

  return attempt;
}

function serializeStartResult(attempt: IAttempt, exam: CandidateExam): StartAttemptResult {
  return {
    attemptId: attempt._id.toString(),
    examId: attempt.examId.toString(),
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    remainingSeconds: computeRemainingSeconds(attempt.expiresAt),
    status: attempt.status,
    exam,
  };
}

async function loadPopulatedExam(examId: Types.ObjectId | string): Promise<IExam> {
  const exam = await ExamModel.findById(examId)
    .populate({ path: "sections.mediaIds", model: "Media" });

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  return exam;
}

export async function startAttempt(
  studentId: string,
  examId: string,
  assignmentId?: string
): Promise<StartAttemptResult> {
  const exam = await ExamModel.findById(examId);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  if (exam.status !== "published") {
    throw new BadRequestError("EXAM_NOT_PUBLISHED", "Đề thi chưa được xuất bản.");
  }

  if (exam.openAt && Date.now() < exam.openAt.getTime()) {
    throw new BadRequestError("EXAM_NOT_OPENED", "Đề thi chưa đến thời gian mở.");
  }

  if (exam.closeAt && Date.now() > exam.closeAt.getTime()) {
    throw new BadRequestError("EXAM_CLOSED", "Đề thi đã kết thúc thời gian làm bài.");
  }

  const isPractice = exam.kind === "practice";
  const examScoringMode: "band" | "raw" =
    isPractice ? "raw" : exam.scoringMode ?? "band";
  const bandConversionSnapshot: IBandConversion | undefined =
    !isPractice && examScoringMode === "band" ? exam.bandConversion : undefined;

  if (env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT && !assignmentId && !isPractice) {
    throw new BadRequestError(
      "ASSIGNMENT_REQUIRED",
      "Cần bắt đầu bài thi từ bài tập được giao."
    );
  }

  let assignmentDoc: IAssignment | null = null;

  if (assignmentId) {
    const assignment = await AssignmentModel.findById(assignmentId);

    if (!assignment) {
      throw new NotFoundError("Bài tập không tồn tại.");
    }

    if (assignment.status !== "active") {
      throw new BadRequestError("VALIDATION_ERROR", "Bài tập không còn hiệu lực.");
    }

    const completedAttempts = await AttemptModel.countDocuments({
      studentId,
      assignmentId,
      status: { $in: ["submitted", "expired"] },
    });

    if (completedAttempts >= (assignment.maxAttempts ?? 1)) {
      throw new BadRequestError(
        "ASSIGNMENT_MAX_ATTEMPTS_REACHED",
        "Bạn đã hoàn thành số lần làm bài tối đa của bài tập này."
      );
    }

    if (assignment.examId.toString() !== examId) {
      throw new BadRequestError("VALIDATION_ERROR", "Bài tập không khớp với đề thi yêu cầu.");
    }

    if (assignment.studentId && assignment.studentId.toString() !== studentId) {
      throw new ForbiddenError("FORBIDDEN", "Bài tập này không được phân bổ cho bạn.");
    }

    if (assignment.classId) {
      const isMember = await ClassModel.exists({
        _id: assignment.classId,
        students: new mongoose.Types.ObjectId(studentId),
      });
      if (!isMember) {
        throw new ForbiddenError("FORBIDDEN", "Bạn không phải thành viên của lớp được giao bài này.");
      }
    }

    if (assignment.deadline && Date.now() > assignment.deadline.getTime()) {
      throw new BadRequestError(
        "ASSIGNMENT_DEADLINE_PASSED",
        "Đã quá hạn nộp bài tập."
      );
    }

    assignmentDoc = assignment;
  }

  const populatedExam = await loadPopulatedExam(examId);
  const mediaUrlMap = await presignMediaMap(
    populatedExam,
    examMediaPresignTtl(exam.durationMinutes)
  );
  const candidateExam = buildCandidateExam(populatedExam, mediaUrlMap);

  // FIX-12: when starting from an assignment, prefer the attempt already bound
  // to that assignment so multi-attempt accounting stays correct.
  let existingAttempt = assignmentId
    ? await AttemptModel.findOne({ studentId, assignmentId, status: "in_progress" })
    : null;

  if (!existingAttempt) {
    existingAttempt = await AttemptModel.findOne({
      studentId,
      examId,
      status: "in_progress",
    });

    // Attach the assignment to a free attempt so this submission counts toward
    // the assignment's maxAttempts (only when the assignment was validated).
    if (existingAttempt && assignmentDoc && !existingAttempt.assignmentId) {
      existingAttempt.assignmentId = assignmentDoc._id;
      await existingAttempt.save();
    }
  }

  if (existingAttempt) {
    return serializeStartResult(
      existingAttempt,
      applyQuestionOrder(candidateExam, existingAttempt.questionOrder ?? [])
    );
  }

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000);
  const questionOrder = assignmentDoc?.shuffleQuestions
    ? shuffleQuestionIds(collectCandidateQuestionIds(candidateExam), startedAt.getTime())
    : [];

  const skills = [...new Set((populatedExam.sections ?? []).map((s) => s.skill))];
  let questionCount = 0;
  let totalPoints = 0;
  for (const s of populatedExam.sections ?? []) {
    for (const g of s.questionGroups ?? []) {
      questionCount += (g.questions ?? []).length;
      for (const q of g.questions ?? []) {
        totalPoints += q.points ?? 1;
      }
    }
  }

  try {
    const attempt = await AttemptModel.create({
      examId: exam._id,
      studentId: new mongoose.Types.ObjectId(studentId),
      assignmentId: assignmentId ? new mongoose.Types.ObjectId(assignmentId) : undefined,
      startedAt,
      expiresAt,
      status: "in_progress",
      answers: [],
      scores: {},
      suspicious: false,
      questionOrder,
      examKind: (exam.kind ?? "mock") as ExamKind,
      scoringMode: examScoringMode,
      bandConversionSnapshot,
      skills,
      questionCount,
      totalPoints,
    });

    return serializeStartResult(attempt, applyQuestionOrder(candidateExam, questionOrder));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const concurrentAttempt = await AttemptModel.findOne({
        studentId,
        examId,
        status: "in_progress",
      });

      if (concurrentAttempt) {
        return serializeStartResult(
          concurrentAttempt,
          applyQuestionOrder(candidateExam, concurrentAttempt.questionOrder ?? [])
        );
      }
    }

    throw error;
  }
}

export async function finalizeAttempt(
  attempt: IAttempt,
  submittedAt: Date,
  message?: string,
  targetStatus: "submitted" | "expired" = "submitted"
): Promise<SubmitAttemptResult> {
  const populatedExam = await loadPopulatedExam(attempt.examId);
  const examObj = populatedExam.toObject() as unknown as RawExamObject;
  const {
    listeningGrouped, readingGrouped,
    hasListening, hasReading, hasWriting,
  } = collectExamQuestionBuckets(examObj);

  const scores: IAttemptScores = {
    listeningRaw: attempt.scores.listeningRaw,
    listeningBand: attempt.scores.listeningBand,
    readingRaw: attempt.scores.readingRaw,
    readingBand: attempt.scores.readingBand,
    writingTask1Band: attempt.scores.writingTask1Band,
    writingTask2Band: attempt.scores.writingTask2Band,
    writingBand: attempt.scores.writingBand,
    overallBand: attempt.scores.overallBand,
  };

  const examKind = (populatedExam.kind ?? "mock") as ExamKind;
  const scoringMode =
    examKind === "practice"
      ? "raw"
      : attempt.scoringMode ??
        populatedExam.scoringMode ??
        "band";
  const rawMode = scoringMode === "raw";
  const bandConversion =
    attempt.bandConversionSnapshot ?? populatedExam.bandConversion;

  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;

  if (hasListening) {
    const breakdown = gradeGroupedQuestionsDetailed(
      attempt.answers,
      listeningGrouped
    );
    scores.listeningRaw = breakdown.rawScore;
    correctCount += breakdown.correctCount;
    wrongCount += breakdown.wrongCount;
    blankCount += breakdown.blankCount;
    if (!rawMode) {
      scores.listeningBand = resolveBandScore(
        breakdown.rawScore,
        "listening",
        bandConversion
      );
    }
  }

  if (hasReading) {
    const breakdown = gradeGroupedQuestionsDetailed(
      attempt.answers,
      readingGrouped
    );
    scores.readingRaw = breakdown.rawScore;
    correctCount += breakdown.correctCount;
    wrongCount += breakdown.wrongCount;
    blankCount += breakdown.blankCount;
    if (!rawMode) {
      scores.readingBand = resolveBandScore(
        breakdown.rawScore,
        "reading",
        bandConversion
      );
    }
  }

  if (rawMode) {
    scores.listeningBand = undefined;
    scores.readingBand = undefined;
    scores.overallBand = undefined;
  } else if (!hasWriting && (hasListening || hasReading)) {
    scores.overallBand = calculateOverallBand({
      listening: scores.listeningBand,
      reading: scores.readingBand,
    });
  }

  const updatedAttempt = await AttemptModel.findOneAndUpdate(
    { _id: attempt._id, studentId: attempt.studentId, status: "in_progress" },
    {
      $set: {
        status: targetStatus,
        submittedAt,
        scores,
        correctCount,
        wrongCount,
        blankCount,
      },
    },
    { new: true }
  );

  if (!updatedAttempt) {
    const current = await AttemptModel.findById(attempt._id);
    if (current && (current.status === "submitted" || current.status === "expired")) {
      attempt.status = current.status;
      attempt.submittedAt = current.submittedAt;
      attempt.scores = current.scores;
      return {
        attemptId: current._id.toString(),
        status: current.status,
        submittedAt: current.submittedAt ?? submittedAt,
        scores: serializeScores(current.scores),
        ...(message ? { message } : {}),
      };
    }
    throw new BadRequestError("VALIDATION_ERROR", "Không thể nộp bài thi.");
  }

  attempt.status = targetStatus;
  attempt.submittedAt = submittedAt;
  attempt.scores = updatedAttempt.scores;

  logger.info("attempt.finalized", {
    attemptId: updatedAttempt._id.toString(),
    studentId: attempt.studentId.toString(),
    status: targetStatus,
    expired: targetStatus === "expired",
  });

  return {
    attemptId: updatedAttempt._id.toString(),
    status: updatedAttempt.status,
    submittedAt,
    scores: serializeScores(updatedAttempt.scores),
    ...(message ? { message } : {}),
  };
}

export async function getAttemptForRecovery(
  attemptId: string,
  studentId: string
): Promise<AttemptRecoveryResult> {
  const attempt = await findOwnedAttempt(attemptId, studentId);
  const populatedExam = await loadPopulatedExam(attempt.examId);

  const remainingSeconds = computeRemainingSeconds(attempt.expiresAt);

  if (remainingSeconds <= 0 && attempt.status === "in_progress") {
    await finalizeAttempt(
      attempt,
      attempt.expiresAt,
      "Bài thi đã được tự động nộp do hết thời gian làm bài.",
      "expired"
    );
  }

  return {
    attemptId: attempt._id.toString(),
    status: attempt.status,
    remainingSeconds: attempt.status === "in_progress" ? remainingSeconds : 0,
    answers: attempt.answers.map((answer) => ({
      questionId: answer.questionId.toString(),
      value: answer.value,
    })),
    exam: applyQuestionOrder(
      buildCandidateExam(
        populatedExam,
        await presignMediaMap(
          populatedExam,
          examMediaPresignTtl(populatedExam.durationMinutes)
        )
      ),
      attempt.questionOrder ?? []
    ),
  };
}

export function toSafeQuestionObjectId(id: unknown): Types.ObjectId {
  const str = String(id ?? "").trim();
  if (mongoose.Types.ObjectId.isValid(str) && /^[0-9a-fA-F]{24}$/.test(str)) {
    return new mongoose.Types.ObjectId(str);
  }
  const hash = crypto.createHash("md5").update(str).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hash);
}

export async function autosaveAnswers(
  attemptId: string,
  studentId: string,
  answers: { questionId: string; value: string }[]
): Promise<AutosaveResult> {
  const attempt = await findOwnedAttempt(attemptId, studentId);

  if (attempt.status !== "in_progress") {
    throw new BadRequestError("EXAM_ALREADY_SUBMITTED", "Bài thi đã được nộp trước đó.");
  }

  const graceDeadline = attempt.expiresAt.getTime() + EXAM_GRACE_PERIOD_SECONDS * 1000;

  if (Date.now() > graceDeadline) {
    throw new ForbiddenError(
      "EXAM_EXPIRED",
      "Thời gian làm bài thi đã kết thúc. Không thể gửi thêm đáp án."
    );
  }

  const savedAt = new Date();

  for (const incoming of answers) {
    if (!incoming.questionId) continue;
    const qObjectId = toSafeQuestionObjectId(incoming.questionId);
    const existing = attempt.answers.find(
      (answer) => answer.questionId.toString() === qObjectId.toString()
    );

    if (existing) {
      existing.value = incoming.value ?? "";
      existing.savedAt = savedAt;
    } else {
      attempt.answers.push({
        questionId: qObjectId,
        value: incoming.value ?? "",
        savedAt,
      });
    }
  }

  await attempt.save();

  return {
    savedCount: answers.length,
    serverRemainingSeconds: computeRemainingSeconds(attempt.expiresAt),
  };
}

export async function submitAttempt(
  attemptId: string,
  studentId: string
): Promise<SubmitAttemptResult> {
  const attempt = await findOwnedAttempt(attemptId, studentId);

  if (attempt.status !== "in_progress") {
    throw new BadRequestError("EXAM_ALREADY_SUBMITTED", "Bài thi đã được nộp trước đó.");
  }

  const graceDeadline = attempt.expiresAt.getTime() + EXAM_GRACE_PERIOD_SECONDS * 1000;

  if (Date.now() > graceDeadline) {
    return finalizeAttempt(
      attempt,
      attempt.expiresAt,
      "Bài thi đã được tự động nộp do hết thời gian làm bài.",
      "expired"
    );
  }

  return finalizeAttempt(attempt, new Date());
}

export function canAccessAttemptResult(
  attemptStudentId: string,
  user: { id: string; role: string }
): boolean {
  if (user.role === "admin" || user.role === "teacher") {
    return true;
  }
  return attemptStudentId === user.id;
}

export async function getAttemptResult(
  attemptId: string,
  currentUser: { id: string; role: string }
): Promise<AttemptResult> {
  const attempt = await AttemptModel.findById(attemptId)
    .populate([
      { path: "examId", select: "createdBy title durationMinutes" },
      { path: "studentId", select: "name fullName email" },
      { path: "assignmentId", select: "teacherId showScoreAfterSubmit" },
    ]);

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  const studentOwnerId =
    (attempt.studentId as unknown as { _id?: Types.ObjectId | string })?._id?.toString() ??
    attempt.studentId.toString();

  if (currentUser.role === "student") {
    if (studentOwnerId !== currentUser.id) {
      throw new ForbiddenError(
        "ATTEMPT_NOT_OWNED",
        "Học sinh không có quyền truy cập bài làm này."
      );
    }
  } else {
    assertTeacherOwnsAttempt(attempt, currentUser.id, currentUser.role);
  }

  if (attempt.status !== "submitted" && attempt.status !== "expired") {
    throw new BadRequestError("EXAM_NOT_SUBMITTED", "Bài thi chưa được nộp.");
  }

  const assignment = attempt.assignmentId as unknown as {
    showScoreAfterSubmit?: boolean;
  } | null;
  const showScore = !(currentUser.role === "student" && assignment?.showScoreAfterSubmit === false);

  const examIdRef =
    (attempt.examId as unknown as { _id?: Types.ObjectId })._id ?? attempt.examId;
  const populatedExam = await loadPopulatedExam(examIdRef);
  const examObj = populatedExam.toObject() as unknown as RawExamObject;
  const details: ResultQuestionDetail[] = [];
  // FIX-22: index answers once instead of scanning per question.
  const answerByQuestionId = new Map(
    attempt.answers.map((answer) => [answer.questionId.toString(), answer.value])
  );

  for (const section of examObj.sections ?? []) {
    for (const group of section.questionGroups ?? []) {
      for (const q of group.questions ?? []) {
        const studentAnswer = answerByQuestionId.get(q._id.toString()) ?? null;
        const acceptedAnswers = q.acceptedAnswers ?? [];

        let isCorrect = false;
        if (studentAnswer !== null) {
          const withinWordLimit =
            !shouldEnforceWordLimit(group.groupType) ||
            checkWordLimit(studentAnswer, group.config ?? {});
          isCorrect = withinWordLimit && matchAnswer(studentAnswer, acceptedAnswers);
        }

        details.push({
          questionId: q._id.toString(),
          questionNumber: q.questionNumber,
          groupType: group.groupType,
          studentAnswer,
          acceptedAnswers,
          isCorrect,
          explanation: q.explanation ?? null,
        });
      }
    }
  }

  const review = await WritingReviewModel.findOne({ attemptId: attempt._id });

  const student = attempt.studentId as unknown as { name?: string; fullName?: string; email?: string } | null;
  const exam = attempt.examId as unknown as { title?: string; durationMinutes?: number } | null;

  const startedAt = attempt.startedAt;
  const submittedAt = attempt.submittedAt ?? attempt.updatedAt;
  const durationSeconds =
    startedAt && submittedAt
      ? Math.max(0, Math.round((new Date(submittedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : undefined;

  const examKind = (populatedExam.kind ?? "mock") as ExamKind;
  const scoringMode =
    examKind === "practice"
      ? "raw"
      : attempt.scoringMode ??
        populatedExam.scoringMode ??
        "band";
  const rawMode = scoringMode === "raw";

  let questionCount = attempt.questionCount;
  let totalPoints = attempt.totalPoints;
  if (!questionCount || !totalPoints) {
    let count = 0;
    let points = 0;
    for (const section of examObj.sections ?? []) {
      for (const group of section.questionGroups ?? []) {
        count += (group.questions ?? []).length;
        for (const q of group.questions ?? []) {
          points += q.points ?? 1;
        }
      }
    }
    if (!questionCount) questionCount = count;
    if (!totalPoints) totalPoints = points;
  }

  let correctCount = attempt.correctCount;
  let wrongCount = attempt.wrongCount;
  let blankCount = attempt.blankCount;
  if (
    correctCount === undefined ||
    wrongCount === undefined ||
    blankCount === undefined
  ) {
    correctCount = 0;
    wrongCount = 0;
    blankCount = 0;
    for (const detail of details) {
      if (detail.groupType?.startsWith("writing")) continue;
      if (!detail.studentAnswer || detail.studentAnswer.trim() === "") {
        blankCount += 1;
      } else if (detail.isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
      }
    }
  }

  let rawScore: number | undefined;
  let percentage: number | undefined;

  if (rawMode) {
    const listening = attempt.scores?.listeningRaw ?? 0;
    const reading = attempt.scores?.readingRaw ?? 0;
    rawScore = listening + reading;
    percentage =
      totalPoints > 0 ? Math.round((rawScore / totalPoints) * 100) : 0;
  }

  if (!showScore) {
    rawScore = undefined;
    percentage = undefined;
    correctCount = undefined;
    wrongCount = undefined;
    blankCount = undefined;
    for (const d of details) {
      d.acceptedAnswers = [];
      d.isCorrect = false;
      d.explanation = null;
    }
  }

  const visibleScores = showScore ? serializeScores(attempt.scores) : {};
  if (rawMode) {
    visibleScores.listeningBand = undefined;
    visibleScores.readingBand = undefined;
    visibleScores.overallBand = undefined;
  }

  const postSubmissionResources = showScore
    ? (populatedExam.postSubmissionResources ?? null)
    : null;

  return {
    attemptId: attempt._id.toString(),
    examId: examIdRef.toString(),
    examTitle: exam?.title,
    examDurationMinutes: exam?.durationMinutes,
    studentName: student?.fullName ?? student?.name,
    studentEmail: student?.email,
    status: attempt.status,
    startedAt,
    submittedAt,
    durationSeconds,
    scores: visibleScores,
    writingReview:
      showScore && review
        ? {
            id: review._id.toString(),
            attemptId: review.attemptId.toString(),
            task1: review.task1
              ? {
                  score: review.task1.score,
                  comment: review.task1.comment ?? null,
                }
              : undefined,
            task2: review.task2
              ? {
                  score: review.task2.score,
                  comment: review.task2.comment ?? null,
                }
              : undefined,
            overallWritingScore: review.overallWritingScore,
            generalFeedback: review.generalFeedback ?? null,
            teacherId: review.teacherId.toString(),
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
          }
        : null,
    details,
    postSubmissionResources,
    examKind,
    scoreMode: rawMode ? "raw" : "band",
    questionCount,
    totalPoints,
    rawScore,
    percentage,
    correctCount,
    wrongCount,
    blankCount,
  };
}

export interface MyAttemptExamSummary {
  id: string;
  title: string;
  durationMinutes: number;
  skills: string[];
  kind?: ExamKind;
}

export interface MyAttemptItem {
  id: string;
  exam: MyAttemptExamSummary | null;
  assignmentId: string | null;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  status: AttemptStatus;
  scores: IAttemptScores;
  suspicious: boolean;
  examKind?: ExamKind;
  scoringMode?: "band" | "raw";
  totalPoints?: number;
  rawScore?: number;
  percentage?: number;
  correctCount?: number;
  wrongCount?: number;
  blankCount?: number;
}

export interface MyAttemptsResult {
  items: MyAttemptItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export async function getMyAttempts(
  studentId: string,
  query: GetMyAttemptsQuery
): Promise<MyAttemptsResult> {
  const filter: Record<string, unknown> = {
    studentId: new mongoose.Types.ObjectId(studentId),
  };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.examId && mongoose.isValidObjectId(query.examId)) {
    filter.examId = new mongoose.Types.ObjectId(query.examId);
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const skip = (page - 1) * limit;

  const [total, attempts] = await Promise.all([
    AttemptModel.countDocuments(filter),
    AttemptModel.find(filter)
      .populate("examId", "title durationMinutes sections.skill kind")
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  const items: MyAttemptItem[] = attempts.map((attempt) => {
    const examDoc = attempt.examId as unknown as {
      _id: Types.ObjectId;
      title?: string;
      durationMinutes?: number;
      kind?: ExamKind;
      sections?: { skill?: string }[];
    } | null;

    const examKind: ExamKind =
      (attempt.examKind ?? examDoc?.kind ?? "mock") as ExamKind;
    const scoringMode =
      examKind === "practice"
        ? "raw"
        : attempt.scoringMode ?? "band";
    const rawScore =
      (attempt.scores?.listeningRaw ?? 0) + (attempt.scores?.readingRaw ?? 0);
    const totalPoints = attempt.totalPoints ?? 0;
    const visibleScores = serializeScores(attempt.scores);
    if (scoringMode === "raw") {
      visibleScores.listeningBand = undefined;
      visibleScores.readingBand = undefined;
      visibleScores.overallBand = undefined;
    }

    const examSummary: MyAttemptExamSummary | null = examDoc
      ? {
          id: examDoc._id.toString(),
          title: examDoc.title ?? "",
          durationMinutes: examDoc.durationMinutes ?? 0,
          skills: Array.from(
            new Set((examDoc.sections ?? []).map((s) => s.skill).filter(Boolean) as string[])
          ),
          kind: (examDoc.kind ?? examKind) as ExamKind,
        }
      : null;

    return {
      id: attempt._id.toString(),
      exam: examSummary,
      assignmentId: attempt.assignmentId ? attempt.assignmentId.toString() : null,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      submittedAt: attempt.submittedAt ?? null,
      status: attempt.status,
      scores: visibleScores,
      suspicious: attempt.suspicious,
      examKind,
      scoringMode,
      totalPoints,
      rawScore,
      percentage:
        scoringMode === "raw" && totalPoints > 0
          ? Math.round((rawScore / totalPoints) * 100)
          : undefined,
      correctCount: attempt.correctCount,
      wrongCount: attempt.wrongCount,
      blankCount: attempt.blankCount,
    };
  });

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}
