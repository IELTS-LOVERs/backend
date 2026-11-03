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
import { ExamModel } from "../exams/exam.model.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
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


interface PopulatedGradingSection {
  skill?: string;
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

interface PopulatedStudentSummary {
  _id: Types.ObjectId;
  fullName?: string;
  email?: string;
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
  role: string,
  options: { page?: number; limit?: number } = {}
): Promise<PendingWritingResult> {
  const writingExamsQuery = ExamModel.find({ "sections.skill": "writing" }).select(
    "_id title createdBy"
  );
  const writingExams =
    typeof (writingExamsQuery as { lean?: () => unknown }).lean === "function"
      ? await (writingExamsQuery as { lean: () => Promise<Array<{ _id: unknown; title?: string; createdBy?: unknown }>> }).lean()
      : await (writingExamsQuery as unknown as Promise<Array<{ _id: unknown; title?: string; createdBy?: unknown }>>);

  const writingExamMap = new Map<string, { _id: unknown; title?: string; createdBy?: unknown }>(
    (writingExams ?? []).map((e) => [String(e._id), e])
  );
  const writingExamIds = Array.from(writingExamMap.keys());

  if (writingExamIds.length === 0) {
    return { items: [], totalPending: 0 };
  }

  const attemptFilter: Record<string, unknown> = {
    status: { $in: ["submitted", "expired"] },
    examId: { $in: writingExamIds },
  };

  if (role !== "admin") {
    const teacherAssignmentsQuery = AssignmentModel.find({
      teacherId,
      examId: { $in: writingExamIds },
    }).select("_id");
    const teacherAssignments =
      typeof (teacherAssignmentsQuery as { lean?: () => unknown }).lean === "function"
        ? await (teacherAssignmentsQuery as { lean: () => Promise<Array<{ _id: unknown }>> }).lean()
        : await (teacherAssignmentsQuery as unknown as Promise<Array<{ _id: unknown }>>);
    const teacherAssignmentIds = (teacherAssignments ?? []).map((a) => a._id);

    const teacherCreatedExamIds = (writingExams ?? [])
      .filter((e) => e.createdBy && String(e.createdBy) === String(teacherId))
      .map((e) => e._id);

    attemptFilter.$or = [
      { examId: { $in: teacherCreatedExamIds } },
      { assignmentId: { $in: teacherAssignmentIds } },
    ];
  }

  const attemptsQuery = AttemptModel.find(attemptFilter)
    .select("_id examId studentId assignmentId submittedAt suspicious")
    .populate("studentId", "fullName email")
    .sort({ submittedAt: 1 });

  const attempts =
    typeof (attemptsQuery as { lean?: () => unknown }).lean === "function"
      ? await (attemptsQuery as { lean: () => Promise<Array<Record<string, unknown>>> }).lean()
      : await (attemptsQuery as unknown as Promise<Array<Record<string, unknown>>>);

  const attemptIds: string[] = (attempts ?? []).map((a) => String(a._id));
  let reviewedIds = new Set<string>();
  if (attemptIds.length > 0) {
    const reviewsQuery = WritingReviewModel.find({ attemptId: { $in: attemptIds } }).select(
      "attemptId"
    );
    const reviews =
      typeof (reviewsQuery as { lean?: () => unknown }).lean === "function"
        ? await (reviewsQuery as { lean: () => Promise<Array<{ attemptId: unknown }>> }).lean()
        : await (reviewsQuery as unknown as Promise<Array<{ attemptId: unknown }>>);
    reviewedIds = new Set((reviews ?? []).map((r) => String(r.attemptId)));
  }

  const pendingAttempts = (attempts ?? []).filter((a) => !reviewedIds.has(String(a._id)));

  const items: PendingWritingSubmission[] = pendingAttempts.map((attempt) => {
    const exam = writingExamMap.get(String(attempt.examId));
    const student = attempt.studentId as { fullName?: string; email?: string } | null;
    return {
      attemptId: String(attempt._id),
      studentName: student?.fullName ?? "",
      studentEmail: student?.email ?? "",
      examTitle: exam?.title ?? "",
      submittedAt: (attempt.submittedAt as Date | null) ?? null,
      hasSuspiciousActivity: Boolean(attempt.suspicious),
    };
  });

  const totalPending = items.length;
  const paginationRequested =
    options.page !== undefined || options.limit !== undefined;
  const paginatedItems = paginationRequested
    ? items.slice(
        (Math.max(1, options.page ?? 1) - 1) * Math.max(1, options.limit ?? 20),
        Math.max(1, options.page ?? 1) * Math.max(1, options.limit ?? 20)
      )
    : items;

  return { items: paginatedItems, totalPending };
}

export async function getAttemptForGrading(
  attemptId: string,
  teacherId: string,
  role: string
): Promise<AttemptGradingView> {
  const attempt = await AttemptModel.findById(attemptId)
    .populate([
      { path: "examId", select: "title createdBy sections" },
      { path: "assignmentId", select: "teacherId" },
      { path: "studentId", select: "fullName" },
    ]);

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

  // Preferred path: the snapshot frozen at submit time keeps the prompt and the
  // student's text stable even if the teacher edits the exam afterwards.
  for (const detail of attempt.resultDetails ?? []) {
    const task: 1 | 2 | null =
      detail.groupType === "writing_task_1"
        ? 1
        : detail.groupType === "writing_task_2"
          ? 2
          : null;
    if (task === null || tasksByNumber.has(task)) continue;

    const studentContent = detail.studentAnswer ?? "";
    tasksByNumber.set(task, {
      task,
      prompt: detail.prompt ?? "",
      studentContent,
      wordCount: countWords(studentContent),
    });
  }

  // Legacy attempts (no snapshot yet): fall back to the live exam.
  if (tasksByNumber.size === 0) {
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
    .populate([
      { path: "examId", select: "createdBy" },
      { path: "assignmentId", select: "teacherId" },
    ]);

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
