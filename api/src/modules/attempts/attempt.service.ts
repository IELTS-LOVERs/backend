import crypto from "crypto";
import mongoose, { type Types } from "mongoose";
import { EXAM_GRACE_PERIOD_SECONDS } from "../../config/constants.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { resolveBandScore } from "../../common/utils/band-conversion.js";
import { calculateOverallBand } from "../../common/utils/ielts-calculator.js";
import { logger } from "../../common/utils/logger.js";
import { AssignmentModel, type IAssignment } from "../assignments/assignment.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel, type IExam } from "../exams/exam.model.js";
import { assertTeacherOwnsAttempt } from "../grading/grading.service.js";
import { WritingReviewModel } from "../grading/writing-review.model.js";
import "../questions/question.model.js";
import { env } from "../../config/env.js";
import {
  AttemptModel,
  type AttemptStatus,
  type IAttempt,
  type IAttemptScores,
} from "./attempt.model.js";
import type { ExamKind, IBandConversion } from "../exams/exam.model.js";
import type { GetMyAttemptsQuery } from "./attempt.validation.js";

export * from "./attempt.types.js";
export * from "./attempt-candidate.builder.js";
export * from "./attempt-grading.js";

import type {
  AttemptExamResult,
  AttemptRecoveryResult,
  AttemptResult,
  AttemptRevisionResult,
  AutosaveResult,
  CandidateExam,
  RawExamObject,
  ResultQuestionDetail,
  StartAttemptResult,
  SubmitAttemptResult,
} from "./attempt.types.js";

import {
  applyQuestionOrder,
  buildCandidateExam,
  collectCandidateQuestionIds,
  computeRemainingSeconds,
  examMediaPresignTtl,
  presignMediaMap,
  shuffleQuestionIds,
} from "./attempt-candidate.builder.js";

import {
  buildResultDetails,
  collectExamQuestionBuckets,
  gradeGroupedQuestionsDetailed,
  serializeScores,
} from "./attempt-grading.js";

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

function serializeStartResult(
  attempt: IAttempt,
  exam: CandidateExam,
  revision: number
): StartAttemptResult {
  return {
    attemptId: attempt._id.toString(),
    examId: attempt.examId.toString(),
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    remainingSeconds: computeRemainingSeconds(attempt.expiresAt),
    status: attempt.status,
    exam,
    revision,
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
      applyQuestionOrder(candidateExam, existingAttempt.questionOrder ?? []),
      populatedExam.contentRevision ?? 0
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

    return serializeStartResult(
      attempt,
      applyQuestionOrder(candidateExam, questionOrder),
      populatedExam.contentRevision ?? 0
    );
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
          applyQuestionOrder(candidateExam, concurrentAttempt.questionOrder ?? []),
          populatedExam.contentRevision ?? 0
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

  // Freeze the result now: the live exam may be edited after submission.
  const snapshot = buildResultDetails(examObj, attempt.answers);

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
        resultDetails: snapshot.details,
        questionCount: snapshot.questionCount,
        totalPoints: snapshot.totalPoints,
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
  attempt.resultDetails = updatedAttempt.resultDetails;
  attempt.questionCount = updatedAttempt.questionCount;
  attempt.totalPoints = updatedAttempt.totalPoints;

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
    revision: populatedExam.contentRevision ?? 0,
  };
}

/**
 * Lightweight polling endpoint for students currently taking the exam.
 * Returns only the content version, so the client can avoid downloading the
 * full exam on every tick.
 */
export async function getAttemptRevision(
  attemptId: string,
  studentId: string
): Promise<AttemptRevisionResult> {
  const attempt = await findOwnedAttempt(attemptId, studentId);
  const examQuery = ExamModel.findById(attempt.examId);
  const exam =
    typeof (examQuery as { select?: (f: string) => unknown }).select === "function"
      ? await (examQuery as { select: (f: string) => Promise<IExam | null> }).select("contentRevision")
      : await (examQuery as unknown as Promise<IExam | null>);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  return {
    revision: exam.contentRevision ?? 0,
    status: attempt.status,
    remainingSeconds:
      attempt.status === "in_progress"
        ? computeRemainingSeconds(attempt.expiresAt)
        : 0,
  };
}

/**
 * Return the current candidate exam content for an in-progress attempt.
 * Used by the live-sync hook when the revision changes.
 */
export async function getAttemptExam(
  attemptId: string,
  studentId: string
): Promise<AttemptExamResult> {
  const attempt = await findOwnedAttempt(attemptId, studentId);

  if (attempt.status !== "in_progress") {
    throw new BadRequestError(
      "EXAM_ALREADY_SUBMITTED",
      "Bài thi đã được nộp trước đó."
    );
  }

  const populatedExam = await loadPopulatedExam(attempt.examId);
  const mediaUrlMap = await presignMediaMap(
    populatedExam,
    examMediaPresignTtl(populatedExam.durationMinutes)
  );

  return {
    exam: applyQuestionOrder(
      buildCandidateExam(populatedExam, mediaUrlMap),
      attempt.questionOrder ?? []
    ),
    revision: populatedExam.contentRevision ?? 0,
    remainingSeconds: computeRemainingSeconds(attempt.expiresAt),
    updatedAt: populatedExam.updatedAt,
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
      { path: "assignmentId", select: "teacherId showScoreAfterSubmit maxAttempts status deadline" },
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
  let details: ResultQuestionDetail[];

  if (attempt.resultDetails && attempt.resultDetails.length > 0) {
    // Preferred path: immutable snapshot taken at submit time.
    details = attempt.resultDetails.map((detail) => ({
      questionId: detail.questionId.toString(),
      questionNumber: detail.questionNumber,
      groupType: detail.groupType,
      skill: detail.skill,
      studentAnswer: detail.studentAnswer ?? null,
      acceptedAnswers: detail.acceptedAnswers ?? [],
      isCorrect: detail.isCorrect,
      explanation: detail.explanation ?? null,
      points: detail.points,
      prompt: detail.prompt,
    }));
  } else {
    // Legacy attempts submitted before snapshots existed: derive from the
    // live exam. Results are only stable once the backfill script has run.
    const snapshot = buildResultDetails(examObj, attempt.answers);
    details = snapshot.details.map((d) => ({
      questionId: d.questionId.toString(),
      questionNumber: d.questionNumber,
      groupType: d.groupType,
      skill: d.skill,
      studentAnswer: d.studentAnswer,
      acceptedAnswers: d.acceptedAnswers,
      isCorrect: d.isCorrect,
      explanation: d.explanation ?? null,
      points: d.points ?? 1,
      prompt: d.prompt ?? "",
    }));
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

  // Writing questions are excluded so a writing-only practice shows 0/0
  // instead of "0 out of N" (they are graded by a teacher, not by key).
  const objectiveDetails = details.filter(
    (detail) => detail.skill !== "writing"
  );
  const objectiveTotal = objectiveDetails.reduce(
    (acc, detail) => acc + (detail.points ?? 1),
    0
  );
  let rawScore: number | undefined;
  let percentage: number | undefined;

  if (rawMode) {
    const listening = attempt.scores?.listeningRaw ?? 0;
    const reading = attempt.scores?.readingRaw ?? 0;
    rawScore = listening + reading;
    percentage =
      objectiveTotal > 0 ? Math.round((rawScore / objectiveTotal) * 100) : 0;
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

  const assignmentDoc = attempt.assignmentId as unknown as {
    _id?: Types.ObjectId;
    teacherId?: Types.ObjectId;
    showScoreAfterSubmit?: boolean;
    maxAttempts?: number | null;
    status?: string;
    deadline?: Date | null;
  } | null;

  let attemptsUsed = 0;
  let canRetake = false;
  const isExamPublished = populatedExam.status === "published";
  const isExamClosed = Boolean(
    populatedExam.closeAt && new Date(populatedExam.closeAt).getTime() < Date.now()
  );

  if (assignmentDoc && assignmentDoc._id) {
    try {
      attemptsUsed = await AttemptModel.countDocuments({
        assignmentId: assignmentDoc._id,
        studentId: attempt.studentId,
        status: { $in: ["submitted", "expired"] },
      });
    } catch {
      attemptsUsed = 0;
    }
    const isAssignmentActive = assignmentDoc.status === "active";
    const isDeadlinePassed = Boolean(
      assignmentDoc.deadline && new Date(assignmentDoc.deadline).getTime() < Date.now()
    );
    const hasAttemptsLeft =
      assignmentDoc.maxAttempts == null || attemptsUsed < assignmentDoc.maxAttempts;
    canRetake =
      isExamPublished &&
      !isExamClosed &&
      isAssignmentActive &&
      !isDeadlinePassed &&
      hasAttemptsLeft;
  } else if (examKind === "practice") {
    try {
      attemptsUsed = await AttemptModel.countDocuments({
        examId: examIdRef,
        studentId: attempt.studentId,
        assignmentId: null,
        status: { $in: ["submitted", "expired"] },
      });
    } catch {
      attemptsUsed = 0;
    }
    canRetake = isExamPublished && !isExamClosed;
  }

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
    assignmentId: assignmentDoc?._id ? assignmentDoc._id.toString() : null,
    maxAttempts: assignmentDoc?.maxAttempts ?? null,
    attemptsUsed,
    canRetake,
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
