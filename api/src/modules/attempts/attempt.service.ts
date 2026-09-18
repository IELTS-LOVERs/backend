import mongoose, { type Types } from "mongoose";
import { EXAM_GRACE_PERIOD_SECONDS, calculateBandScore } from "../../config/constants.js";
import { env } from "../../config/env.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { calculateOverallBand } from "../../common/utils/ielts-calculator.js";
import { logger } from "../../common/utils/logger.js";
import { matchAnswer } from "../../common/utils/string-normalizer.js";
import { AssignmentModel, type IAssignment } from "../assignments/assignment.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel, type IExam } from "../exams/exam.model.js";
import { assertTeacherOwnsAttempt } from "../grading/grading.service.js";
import { WritingReviewModel } from "../grading/writing-review.model.js";
import "../questions/question.model.js";
import "../media/media.model.js";
import type { SkillType } from "../questions/question.model.js";
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

export interface CandidateExamQuestion {
  id: string;
  prompt: string;
  type: string;
  part: number;
  points: number;
  content: string | null;
  data: Record<string, unknown>;
  mediaIds: string[];
  media: CandidateMediaItem[];
}

export interface CandidateExamSection {
  skill: SkillType;
  part: number;
  title: string;
  instructions: string | null;
  passageText: string | null;
  mediaIds: string[];
  media: CandidateMediaItem[];
  questions: CandidateExamQuestion[];
}

export interface CandidateExam {
  id: string;
  title: string;
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
  status: AttemptStatus;
  scores: IAttemptScores;
  writingReview: AttemptWritingReview | null;
  details: ResultQuestionDetail[];
}

export interface RawPopulatedQuestion {
  _id: Types.ObjectId;
  skill?: SkillType;
  type: string;
  part: number;
  prompt: string;
  content?: string;
  data?: Record<string, unknown>;
  acceptedAnswers?: string[];
  points?: number;
  explanation?: string;
  mediaIds?: unknown[];
}

export interface RawPopulatedSection {
  skill: SkillType;
  part: number;
  title: string;
  instructions?: string;
  passageText?: string;
  mediaIds?: unknown[];
  questionIds?: unknown[];
}

export interface RawExamObject {
  _id: Types.ObjectId;
  title: string;
  sections?: RawPopulatedSection[];
}

export interface GradableQuestion {
  _id: Types.ObjectId;
  acceptedAnswers?: string[];
  points?: number;
}

export interface ExamQuestionBuckets {
  listening: RawPopulatedQuestion[];
  reading: RawPopulatedQuestion[];
  hasListening: boolean;
  hasReading: boolean;
  hasWriting: boolean;
}

function isPopulatedQuestion(value: unknown): value is RawPopulatedQuestion {
  return (
    typeof value === "object" &&
    value !== null &&
    "_id" in value &&
    "prompt" in value &&
    "type" in value
  );
}

function toCandidateMediaItem(item: unknown): CandidateMediaItem | null {
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
    return {
      id: mediaDoc._id.toString(),
      url: `${env.PUBLIC_MEDIA_URL}/${mediaDoc.key}`,
      type: mediaDoc.type,
      originalName: mediaDoc.originalName ?? "",
    };
  }
  return null;
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

export function collectCandidateQuestionIds(exam: CandidateExam): string[] {
  return exam.sections.flatMap((section) => section.questions.map((question) => question.id));
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

  return {
    ...exam,
    sections: exam.sections.map((section) => ({
      ...section,
      questions: [...section.questions].sort((a, b) => {
        const positionA = position.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const positionB = position.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return positionA - positionB;
      }),
    })),
  };
}

/**
 * Whitelist-serializes a populated exam for the candidate, guaranteeing that
 * `acceptedAnswers` and `explanation` can never leak. `.toObject()` is still
 * called and the secret fields are explicitly deleted before mapping.
 */
export function buildCandidateExam(exam: IExam): CandidateExam {
  const examObj = exam.toObject() as unknown as RawExamObject;

  return {
    id: examObj._id.toString(),
    title: examObj.title,
    sections: (examObj.sections ?? []).map((section) => {
      const sectionMedia = (section.mediaIds ?? [])
        .map(toCandidateMediaItem)
        .filter((m): m is CandidateMediaItem => m !== null);
      const sectionMediaIds = (section.mediaIds ?? []).map(extractMediaId);

      const questions = (section.questionIds ?? [])
        .filter(isPopulatedQuestion)
        .map((question) => {
          delete question.acceptedAnswers;
          delete question.explanation;

          const questionMedia = (question.mediaIds ?? [])
            .map(toCandidateMediaItem)
            .filter((m): m is CandidateMediaItem => m !== null);
          const questionMediaIds = (question.mediaIds ?? []).map(extractMediaId);

          return {
            id: question._id.toString(),
            prompt: question.prompt,
            type: question.type,
            part: question.part,
            points: question.points ?? 1,
            content: question.content ?? null,
            data: question.data ?? {},
            mediaIds: questionMediaIds,
            media: questionMedia,
          };
        });

      return {
        skill: section.skill,
        part: section.part,
        title: section.title,
        instructions: section.instructions ?? null,
        passageText: section.passageText ?? null,
        mediaIds: sectionMediaIds,
        media: sectionMedia,
        questions,
      };
    }),
  };
}

export function collectExamQuestionBuckets(examObj: RawExamObject): ExamQuestionBuckets {
  const listening: RawPopulatedQuestion[] = [];
  const reading: RawPopulatedQuestion[] = [];
  let hasListening = false;
  let hasReading = false;
  let hasWriting = false;

  for (const section of examObj.sections ?? []) {
    if (section.skill === "listening") hasListening = true;
    else if (section.skill === "reading") hasReading = true;
    else if (section.skill === "writing") hasWriting = true;

    for (const item of section.questionIds ?? []) {
      if (!isPopulatedQuestion(item)) continue;

      const skill = item.skill ?? section.skill;

      if (skill === "listening") listening.push(item);
      else if (skill === "reading") reading.push(item);
      else if (skill === "writing") hasWriting = true;
    }
  }

  return { listening, reading, hasListening, hasReading, hasWriting };
}

export function gradeQuestions(
  answers: Pick<IAttemptAnswer, "questionId" | "value">[],
  questions: GradableQuestion[]
): number {
  let rawScore = 0;

  for (const question of questions) {
    const answer = answers.find(
      (candidate) => candidate.questionId.toString() === question._id.toString()
    );

    if (!answer) continue;

    if (matchAnswer(answer.value, question.acceptedAnswers ?? [])) {
      rawScore += question.points ?? 1;
    }
  }

  return rawScore;
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
    .populate({ path: "sections.mediaIds", model: "Media" })
    .populate({
      path: "sections.questionIds",
      model: "Question",
      populate: { path: "mediaIds", model: "Media" },
    });

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

  if (env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT && !assignmentId) {
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
  const candidateExam = buildCandidateExam(populatedExam);

  const existingAttempt = await AttemptModel.findOne({
    studentId,
    examId,
    status: "in_progress",
  });

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

  try {
    const attempt = await AttemptModel.create({
      examId: exam._id,
      studentId: new mongoose.Types.ObjectId(studentId),
      assignmentId: assignmentId ? new mongoose.Types.ObjectId(assignmentId) : undefined,
      startedAt,
      expiresAt,
      status: "in_progress",
      answers: [],
      suspicious: false,
      questionOrder,
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
  const { listening, reading, hasListening, hasReading, hasWriting } =
    collectExamQuestionBuckets(examObj);

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

  if (hasListening) {
    const rawScore = gradeQuestions(attempt.answers, listening);
    scores.listeningRaw = rawScore;
    scores.listeningBand = calculateBandScore(rawScore, "listening");
  }

  if (hasReading) {
    const rawScore = gradeQuestions(attempt.answers, reading);
    scores.readingRaw = rawScore;
    scores.readingBand = calculateBandScore(rawScore, "reading");
  }

  if (!hasWriting && (hasListening || hasReading)) {
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
      buildCandidateExam(populatedExam),
      attempt.questionOrder ?? []
    ),
  };
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
    const existing = attempt.answers.find(
      (answer) => answer.questionId.toString() === incoming.questionId
    );

    if (existing) {
      existing.value = incoming.value;
      existing.savedAt = savedAt;
    } else {
      attempt.answers.push({
        questionId: new mongoose.Types.ObjectId(incoming.questionId),
        value: incoming.value,
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
    .populate("examId", "createdBy")
    .populate("assignmentId", "teacherId showScoreAfterSubmit");

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  if (currentUser.role === "student") {
    if (attempt.studentId.toString() !== currentUser.id) {
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

  for (const section of examObj.sections ?? []) {
    for (const item of section.questionIds ?? []) {
      if (!isPopulatedQuestion(item)) continue;

      const question = item as RawPopulatedQuestion;
      const answer = attempt.answers.find(
        (candidate) => candidate.questionId.toString() === question._id.toString()
      );
      const studentAnswer = answer ? answer.value : null;
      const acceptedAnswers = question.acceptedAnswers ?? [];

      details.push({
        questionId: question._id.toString(),
        studentAnswer,
        acceptedAnswers,
        isCorrect:
          studentAnswer !== null && matchAnswer(studentAnswer, acceptedAnswers),
        explanation: question.explanation ?? null,
      });
    }
  }

  const review = await WritingReviewModel.findOne({ attemptId: attempt._id });

  return {
    attemptId: attempt._id.toString(),
    status: attempt.status,
    scores: showScore ? serializeScores(attempt.scores) : {},
    writingReview: review
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
  };
}

export interface MyAttemptExamSummary {
  id: string;
  title: string;
  durationMinutes: number;
  skills: string[];
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
      .populate("examId", "title durationMinutes sections.skill")
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  const items: MyAttemptItem[] = attempts.map((attempt) => {
    const examDoc = attempt.examId as unknown as {
      _id: Types.ObjectId;
      title?: string;
      durationMinutes?: number;
      sections?: { skill?: string }[];
    } | null;

    const examSummary: MyAttemptExamSummary | null = examDoc
      ? {
          id: examDoc._id.toString(),
          title: examDoc.title ?? "",
          durationMinutes: examDoc.durationMinutes ?? 0,
          skills: Array.from(
            new Set((examDoc.sections ?? []).map((s) => s.skill).filter(Boolean) as string[])
          ),
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
      scores: serializeScores(attempt.scores),
      suspicious: attempt.suspicious,
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

