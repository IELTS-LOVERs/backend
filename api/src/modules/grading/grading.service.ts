import mongoose, { type Types } from "mongoose";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import {
  calculateOverallBand,
  calculateWritingBand,
} from "../../common/utils/ielts-calculator.js";
import { logger } from "../../common/utils/logger.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { WritingReviewModel } from "./writing-review.model.js";
import type { GradeWritingBody } from "./grading.validation.js";

export interface PendingWritingSubmission {
  attemptId: string;
  studentName: string;
  studentEmail: string;
  examTitle: string;
  submittedAt: Date | null;
  hasSuspiciousActivity: boolean;
}

export interface PendingWritingResult {
  items: PendingWritingSubmission[];
  totalPending: number;
}

export interface GradingWritingTask {
  task: 1 | 2;
  prompt: string;
  studentContent: string;
  wordCount: number;
}

export interface AttemptGradingView {
  attemptId: string;
  student: {
    id: string;
    fullName: string;
  };
  writingTasks: GradingWritingTask[];
}

export interface GradeWritingResult {
  id: string;
  attemptId: string;
  task1Score?: number;
  task2Score?: number;
  overallWritingScore: number;
  attemptOverallBand: number;
}

interface OwnershipExam {
  _id: Types.ObjectId;
  createdBy?: Types.ObjectId;
}

interface OwnershipAssignment {
  _id: Types.ObjectId;
  teacherId?: Types.ObjectId;
}

interface PopulatedExamSummary extends OwnershipExam {
  title?: string;
  sections?: { skill?: string }[];
}

interface PopulatedStudentSummary {
  _id: Types.ObjectId;
  fullName?: string;
  email?: string;
}

interface PopulatedWritingQuestion {
  _id: Types.ObjectId;
  type?: string;
  prompt?: string;
}

interface PopulatedGradingSection {
  skill?: string;
  questionIds?: unknown[];
  questionGroups?: Array<{
    groupType?: string;
    questions?: Array<{
      _id: Types.ObjectId;
      prompt?: string;
    }>;
  }>;
}

interface PopulatedGradingExam extends OwnershipExam {
  title?: string;
  sections?: PopulatedGradingSection[];
}

function isPopulatedWritingQuestion(value: unknown): value is PopulatedWritingQuestion {
  return (
    typeof value === "object" &&
    value !== null &&
    "_id" in value &&
    "type" in value
  );
}

/** Counts whitespace-separated words; empty/blank strings yield 0. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Admin bypasses ownership. Otherwise the teacher must own the exam that the
 * attempt was taken from, or own the assignment that delivered it.
 */
export function canTeacherGradeAttempt(
  attempt: { examId: unknown; assignmentId?: unknown },
  teacherId: string,
  role: string
): boolean {
  if (role === "admin") return true;

  const exam = attempt.examId as OwnershipExam | null;
  const assignment = attempt.assignmentId as OwnershipAssignment | null;

  const ownsExam = Boolean(exam?.createdBy && exam.createdBy.toString() === teacherId);
  const ownsAssignment = Boolean(
    assignment?.teacherId && assignment.teacherId.toString() === teacherId
  );

  return ownsExam || ownsAssignment;
}

export function assertTeacherOwnsAttempt(
  attempt: { examId: unknown; assignmentId?: unknown },
  teacherId: string,
  role: string
): void {
  if (!canTeacherGradeAttempt(attempt, teacherId, role)) {
    throw new ForbiddenError(
      "FORBIDDEN",
      "Người dùng không đủ quyền thực hiện hành động."
    );
  }
}

export async function getPendingWritingSubmissions(
  teacherId: string,
  role: string
): Promise<PendingWritingResult> {
  const attempts = await AttemptModel.find({
    status: { $in: ["submitted", "expired"] },
  })
    .populate("examId", "title createdBy sections.skill")
    .populate("studentId", "fullName email")
    .populate("assignmentId", "teacherId")
    .sort({ submittedAt: 1 });

  const gradable = attempts.filter((attempt) => {
    const exam = attempt.examId as unknown as PopulatedExamSummary | null;

    if (!exam) return false;
    if (!(exam.sections ?? []).some((section) => section.skill === "writing")) {
      return false;
    }

    return canTeacherGradeAttempt(attempt, teacherId, role);
  });

  const attemptIds = gradable.map((attempt) => attempt._id);
  const reviewedIds =
    attemptIds.length > 0
      ? new Set(
          (
            await WritingReviewModel.find({ attemptId: { $in: attemptIds } }).select(
              "attemptId"
            )
          ).map((review) => review.attemptId.toString())
        )
      : new Set<string>();

  const items: PendingWritingSubmission[] = [];

  for (const attempt of gradable) {
    if (reviewedIds.has(attempt._id.toString())) continue;

    const exam = attempt.examId as unknown as PopulatedExamSummary;
    const student = attempt.studentId as unknown as PopulatedStudentSummary | null;

    items.push({
      attemptId: attempt._id.toString(),
      studentName: student?.fullName ?? "",
      studentEmail: student?.email ?? "",
      examTitle: exam.title ?? "",
      submittedAt: attempt.submittedAt ?? null,
      hasSuspiciousActivity: attempt.suspicious,
    });
  }

  return { items, totalPending: items.length };
}

export async function getAttemptForGrading(
  attemptId: string,
  teacherId: string,
  role: string
): Promise<AttemptGradingView> {
  const attempt = await AttemptModel.findById(attemptId)
    .populate({ path: "examId", populate: { path: "sections.questionIds" } })
    .populate("assignmentId", "teacherId")
    .populate("studentId", "fullName");

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  if (attempt.status !== "submitted" && attempt.status !== "expired") {
    throw new BadRequestError("EXAM_NOT_SUBMITTED", "Bài thi chưa được nộp.");
  }

  assertTeacherOwnsAttempt(attempt, teacherId, role);

  const exam = attempt.examId as unknown as PopulatedGradingExam | null;
  const student = attempt.studentId as unknown as PopulatedStudentSummary | null;
  const tasksByNumber = new Map<1 | 2, GradingWritingTask>();

  for (const section of exam?.sections ?? []) {
    // New path: question groups
    const hasGroups = Array.isArray(section.questionGroups) && section.questionGroups.length > 0;
    if (hasGroups) {
      for (const group of section.questionGroups!) {
        const task: 1 | 2 | null =
          group.groupType === "writing_task_1" ? 1 : group.groupType === "writing_task_2" ? 2 : null;
        if (task === null || tasksByNumber.has(task)) continue;

        const firstQ = group.questions?.[0];
        if (!firstQ) continue;

        const answer = attempt.answers.find(
          (candidate) => candidate.questionId.toString() === firstQ._id.toString()
        );
        const studentContent = answer?.value ?? "";

        tasksByNumber.set(task, {
          task,
          prompt: firstQ.prompt ?? "",
          studentContent,
          wordCount: countWords(studentContent),
        });
      }
      continue;
    }

    // Legacy path: populated questionIds
    for (const item of section.questionIds ?? []) {
      if (!isPopulatedWritingQuestion(item)) continue;

      const task: 1 | 2 | null =
        item.type === "writing_task_1" ? 1 : item.type === "writing_task_2" ? 2 : null;

      if (task === null || tasksByNumber.has(task)) continue;

      const answer = attempt.answers.find(
        (candidate) => candidate.questionId.toString() === item._id.toString()
      );
      const studentContent = answer?.value ?? "";

      tasksByNumber.set(task, {
        task,
        prompt: item.prompt ?? "",
        studentContent,
        wordCount: countWords(studentContent),
      });
    }
  }

  const writingTasks = [...tasksByNumber.values()].sort((a, b) => a.task - b.task);

  return {
    attemptId: attempt._id.toString(),
    student: {
      id: student?._id?.toString() ?? attempt.studentId.toString(),
      fullName: student?.fullName ?? "",
    },
    writingTasks,
  };
}

export async function gradeWriting(
  data: GradeWritingBody,
  teacherId: string,
  role: string
): Promise<GradeWritingResult> {
  const attempt = await AttemptModel.findById(data.attemptId)
    .populate("examId", "createdBy")
    .populate("assignmentId", "teacherId");

  if (!attempt) {
    throw new NotFoundError("Bài làm không tồn tại.");
  }

  if (attempt.status !== "submitted" && attempt.status !== "expired") {
    throw new BadRequestError("EXAM_NOT_SUBMITTED", "Bài thi chưa được nộp.");
  }

  assertTeacherOwnsAttempt(attempt, teacherId, role);

  let overallWritingScore: number;
  if (data.task1 && data.task2) {
    overallWritingScore = calculateWritingBand(data.task1.score, data.task2.score);
  } else if (data.task1) {
    overallWritingScore = data.task1.score;
  } else if (data.task2) {
    overallWritingScore = data.task2.score;
  } else {
    throw new BadRequestError("VALIDATION_ERROR", "Phải nhập điểm cho ít nhất một Task Writing.");
  }

  const setFields: Record<string, unknown> = {
    studentId: attempt.studentId,
    teacherId: new mongoose.Types.ObjectId(teacherId),
    overallWritingScore,
    generalFeedback: data.generalFeedback,
  };

  if (data.task1) {
    setFields.task1 = { score: data.task1.score, comment: data.task1.comment };
  }
  if (data.task2) {
    setFields.task2 = { score: data.task2.score, comment: data.task2.comment };
  }

  const review = await WritingReviewModel.findOneAndUpdate(
    { attemptId: attempt._id },
    { $set: setFields },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  if (!review) {
    throw new NotFoundError("Không thể lưu đánh giá Writing.");
  }

  if (data.task1) {
    attempt.scores.writingTask1Band = data.task1.score;
  }
  if (data.task2) {
    attempt.scores.writingTask2Band = data.task2.score;
  }
  attempt.scores.writingBand = overallWritingScore;
  attempt.scores.overallBand = calculateOverallBand({
    listening: attempt.scores.listeningBand,
    reading: attempt.scores.readingBand,
    writing: overallWritingScore,
  });
  await attempt.save();

  logger.info("writing.graded", {
    attemptId: attempt._id.toString(),
    teacherId,
    overallWritingScore,
  });

  return {
    id: review._id.toString(),
    attemptId: attempt._id.toString(),
    task1Score: data.task1?.score,
    task2Score: data.task2?.score,
    overallWritingScore,
    attemptOverallBand: attempt.scores.overallBand ?? overallWritingScore,
  };
}
