import mongoose, { type Types } from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "../exams/exam.model.js";
import { UserModel } from "../users/user.model.js";
import { AssignmentModel, type AssignmentStatus } from "./assignment.model.js";
import type { CreateAssignmentBody } from "./assignment.validation.js";

export type SubmissionStatus = "not_started" | "in_progress" | "submitted" | "expired";

const SUBMISSION_STATUS_PRIORITY: Record<SubmissionStatus, number> = {
  not_started: 0,
  expired: 1,
  in_progress: 2,
  submitted: 3,
};

export interface AssignmentSummary {
  id: string;
  examId: string;
  classId: string | null;
  studentId: string | null;
  deadline: Date | null;
  status: AssignmentStatus;
}

export interface MyAssignment {
  id: string;
  examTitle: string;
  durationMinutes: number;
  deadline: Date | null;
  submissionStatus: SubmissionStatus;
}

interface PopulatedExam {
  _id: Types.ObjectId;
  title: string;
  durationMinutes: number;
}

/**
 * Reduces all attempts of a student into a submission status per assignment/exam,
 * preferring submitted > in_progress > expired.
 */
export function resolveSubmissionStatuses(
  attempts: { assignmentId?: string; examId: string; status: SubmissionStatus }[]
): Map<string, SubmissionStatus> {
  const statuses = new Map<string, SubmissionStatus>();

  for (const attempt of attempts) {
    const current = statuses.get(attempt.examId);

    if (
      current === undefined ||
      SUBMISSION_STATUS_PRIORITY[attempt.status] > SUBMISSION_STATUS_PRIORITY[current]
    ) {
      statuses.set(attempt.examId, attempt.status);
    }

    if (attempt.assignmentId) {
      const currentAssignment = statuses.get(attempt.assignmentId);
      if (
        currentAssignment === undefined ||
        SUBMISSION_STATUS_PRIORITY[attempt.status] > SUBMISSION_STATUS_PRIORITY[currentAssignment]
      ) {
        statuses.set(attempt.assignmentId, attempt.status);
      }
    }
  }

  return statuses;
}

export async function create(
  data: CreateAssignmentBody,
  teacherId: string,
  role: string
): Promise<AssignmentSummary> {
  const exam = await ExamModel.findById(data.examId);

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  if (exam.status !== "published") {
    throw new BadRequestError("EXAM_NOT_PUBLISHED", "Đề thi chưa được xuất bản.");
  }

  if (data.classId) {
    const cls = await ClassModel.findById(data.classId);

    if (!cls) {
      throw new NotFoundError("Lớp học không tồn tại.");
    }

    if (role !== "admin" && cls.teacherId.toString() !== teacherId) {
      throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
    }
  }

  if (data.studentId) {
    const student = await UserModel.findById(data.studentId);

    if (!student || student.role !== "student") {
      throw new NotFoundError("Học sinh không tồn tại.");
    }
  }

  const assignment = await AssignmentModel.create({
    examId: new mongoose.Types.ObjectId(data.examId),
    teacherId: new mongoose.Types.ObjectId(teacherId),
    classId: data.classId ? new mongoose.Types.ObjectId(data.classId) : undefined,
    studentId: data.studentId ? new mongoose.Types.ObjectId(data.studentId) : undefined,
    deadline: data.deadline ? new Date(data.deadline) : undefined,
    status: "active",
  });

  return {
    id: assignment._id.toString(),
    examId: assignment.examId.toString(),
    classId: assignment.classId ? assignment.classId.toString() : null,
    studentId: assignment.studentId ? assignment.studentId.toString() : null,
    deadline: assignment.deadline ?? null,
    status: assignment.status,
  };
}

export async function getMyAssignments(studentId: string): Promise<MyAssignment[]> {
  const classes = await ClassModel.find({ students: studentId }).select("_id");
  const classIds = classes.map((cls) => cls._id);

  const assignments = await AssignmentModel.find({
    status: "active",
    $or: [{ classId: { $in: classIds } }, { studentId }],
  })
    .populate("examId", "title durationMinutes")
    .sort({ assignedAt: -1 });

  const entries: Array<Omit<MyAssignment, "submissionStatus"> & { examId: string }> = [];

  for (const assignment of assignments) {
    const exam = assignment.examId as unknown as PopulatedExam | null;

    if (!exam) continue;

    entries.push({
      id: assignment._id.toString(),
      examId: exam._id.toString(),
      examTitle: exam.title,
      durationMinutes: exam.durationMinutes,
      deadline: assignment.deadline ?? null,
    });
  }

  const assignmentIds = entries.map((entry) => new mongoose.Types.ObjectId(entry.id));
  const examIds = entries.map((entry) => new mongoose.Types.ObjectId(entry.examId));

  const attempts =
    entries.length > 0
      ? await AttemptModel.find({
          studentId,
          $or: [
            { assignmentId: { $in: assignmentIds } },
            { examId: { $in: examIds } },
          ],
        }).select("assignmentId examId status")
      : [];

  const statuses = resolveSubmissionStatuses(
    attempts.map((attempt) => ({
      assignmentId: attempt.assignmentId ? attempt.assignmentId.toString() : undefined,
      examId: attempt.examId.toString(),
      status: attempt.status,
    }))
  );

  return entries.map((entry) => ({
    id: entry.id,
    examTitle: entry.examTitle,
    durationMinutes: entry.durationMinutes,
    deadline: entry.deadline,
    submissionStatus: statuses.get(entry.id) ?? statuses.get(entry.examId) ?? "not_started",
  }));
}
