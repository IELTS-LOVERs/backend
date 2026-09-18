import mongoose, { type Types } from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { AttemptModel, type IAttemptScores } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "../exams/exam.model.js";
import { UserModel } from "../users/user.model.js";
import { AssignmentModel, type AssignmentStatus } from "./assignment.model.js";
import type { CreateAssignmentBody, UpdateAssignmentBody } from "./assignment.validation.js";

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
  teacherName: string;
  className: string | null;
  attemptId: string | null;
  scores: IAttemptScores | null;
}

export interface AssignmentDetail {
  id: string;
  exam: {
    id: string;
    title: string;
    durationMinutes: number;
    status: string;
  } | null;
  class: {
    id: string;
    name: string;
    code: string;
  } | null;
  teacher: {
    id: string;
    fullName: string;
  } | null;
  deadline: Date | null;
  status: AssignmentStatus;
  assignedAt: Date;
}

interface PopulatedExam {
  _id: Types.ObjectId;
  title: string;
  durationMinutes: number;
}

interface PopulatedTeacher {
  _id: Types.ObjectId;
  fullName: string;
}

interface PopulatedClass {
  _id: Types.ObjectId;
  name: string;
}

interface AttemptStatusDoc {
  status: SubmissionStatus;
  submittedAt?: Date;
  updatedAt?: Date;
  createdAt?: Date;
}

function attemptTimestamp(attempt: AttemptStatusDoc): number {
  const reference = attempt.submittedAt ?? attempt.updatedAt ?? attempt.createdAt;
  return reference ? reference.getTime() : 0;
}

/**
 * Picks the attempt that best represents an assignment entry for the student:
 * an in-progress attempt takes priority so the card can resume it, otherwise the
 * most recently submitted attempt is used to display the score.
 */
export function selectAssignmentAttempt<T extends AttemptStatusDoc>(candidates: T[]): T | null {
  const inProgress = candidates.find((attempt) => attempt.status === "in_progress");
  if (inProgress) return inProgress;

  const submitted = candidates
    .filter((attempt) => attempt.status === "submitted")
    .sort((a, b) => attemptTimestamp(b) - attemptTimestamp(a));

  return submitted[0] ?? null;
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

export async function getAssignmentById(
  assignmentId: string,
  userId: string,
  role: string
): Promise<AssignmentDetail> {
  const assignment = await AssignmentModel.findById(assignmentId)
    .populate("examId", "title durationMinutes status")
    .populate("classId", "name code")
    .populate("teacherId", "fullName");

  if (!assignment) {
    throw new NotFoundError("Bài tập không tồn tại.");
  }

  const teacher = assignment.teacherId as unknown as PopulatedTeacher | null;
  const teacherIdStr =
    teacher && teacher._id ? teacher._id.toString() : assignment.teacherId?.toString();

  if (role !== "admin" && teacherIdStr !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Không có quyền xem bài tập này.");
  }

  const exam = assignment.examId as unknown as {
    _id?: Types.ObjectId;
    title?: string;
    durationMinutes?: number;
    status?: string;
  } | null;
  const cls = assignment.classId as unknown as {
    _id?: Types.ObjectId;
    name?: string;
    code?: string;
  } | null;

  return {
    id: assignment._id.toString(),
    exam:
      exam && exam._id
        ? {
            id: exam._id.toString(),
            title: exam.title ?? "",
            durationMinutes: exam.durationMinutes ?? 0,
            status: exam.status ?? "",
          }
        : null,
    class:
      cls && cls._id
        ? {
            id: cls._id.toString(),
            name: cls.name ?? "",
            code: cls.code ?? "",
          }
        : null,
    teacher:
      teacher && teacher._id
        ? { id: teacher._id.toString(), fullName: teacher.fullName }
        : null,
    deadline: assignment.deadline ?? null,
    status: assignment.status,
    assignedAt: assignment.assignedAt,
  };
}

export async function updateAssignment(
  assignmentId: string,
  userId: string,
  role: string,
  data: UpdateAssignmentBody
): Promise<{ id: string; deadline: Date | null; status: AssignmentStatus }> {
  const assignment = await AssignmentModel.findById(assignmentId);

  if (!assignment) {
    throw new NotFoundError("Bài tập không tồn tại.");
  }

  if (role !== "admin" && assignment.teacherId.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Không có quyền chỉnh sửa bài tập này.");
  }

  if (data.deadline !== undefined) {
    assignment.deadline = new Date(data.deadline);
  }

  if (data.status !== undefined) {
    assignment.status = data.status;
  }

  await assignment.save();

  return {
    id: assignment._id.toString(),
    deadline: assignment.deadline ?? null,
    status: assignment.status,
  };
}

export async function deleteAssignment(
  assignmentId: string,
  userId: string,
  role: string
): Promise<{ message: string }> {
  const assignment = await AssignmentModel.findById(assignmentId);

  if (!assignment) {
    throw new NotFoundError("Bài tập không tồn tại.");
  }

  if (role !== "admin" && assignment.teacherId.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Không có quyền xóa bài tập này.");
  }

  const inProgress = await AttemptModel.countDocuments({
    assignmentId: assignment._id,
    status: "in_progress",
  });

  if (inProgress > 0) {
    throw new BadRequestError(
      "ASSIGNMENT_HAS_ACTIVE_ATTEMPTS",
      "Không thể xóa bài tập đang có học sinh làm bài."
    );
  }

  await AssignmentModel.deleteOne({ _id: assignment._id });

  return { message: "Đã xóa bài tập thành công" };
}

export async function getMyAssignments(studentId: string): Promise<MyAssignment[]> {
  const classes = await ClassModel.find({ students: studentId }).select("_id");
  const classIds = classes.map((cls) => cls._id);

  const assignments = await AssignmentModel.find({
    status: "active",
    $or: [{ classId: { $in: classIds } }, { studentId }],
  })
    .populate("examId", "title durationMinutes")
    .populate("teacherId", "fullName")
    .populate("classId", "name")
    .sort({ assignedAt: -1 });

  const entries: Array<{
    id: string;
    examId: string;
    examTitle: string;
    durationMinutes: number;
    deadline: Date | null;
    teacherName: string;
    className: string | null;
  }> = [];

  for (const assignment of assignments) {
    const exam = assignment.examId as unknown as PopulatedExam | null;

    if (!exam) continue;

    const teacher = assignment.teacherId as unknown as PopulatedTeacher | null;
    const cls = assignment.classId as unknown as PopulatedClass | null;

    entries.push({
      id: assignment._id.toString(),
      examId: exam._id.toString(),
      examTitle: exam.title,
      durationMinutes: exam.durationMinutes,
      deadline: assignment.deadline ?? null,
      teacherName: teacher?.fullName ?? "",
      className: cls?.name ?? null,
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
        }).select("assignmentId examId status scores submittedAt updatedAt")
      : [];

  const statuses = resolveSubmissionStatuses(
    attempts.map((attempt) => ({
      assignmentId: attempt.assignmentId ? attempt.assignmentId.toString() : undefined,
      examId: attempt.examId.toString(),
      status: attempt.status,
    }))
  );

  return entries.map((entry) => {
    const candidates = attempts.filter(
      (attempt) =>
        attempt.assignmentId?.toString() === entry.id ||
        attempt.examId.toString() === entry.examId
    );
    const selected = selectAssignmentAttempt(candidates);

    return {
      id: entry.id,
      examTitle: entry.examTitle,
      durationMinutes: entry.durationMinutes,
      deadline: entry.deadline,
      submissionStatus: statuses.get(entry.id) ?? statuses.get(entry.examId) ?? "not_started",
      teacherName: entry.teacherName,
      className: entry.className,
      attemptId: selected ? selected._id.toString() : null,
      scores: selected && selected.status === "submitted" ? selected.scores : null,
    };
  });
}

export interface TeacherAssignmentOverview {
  totalStudents: number;
  submittedCount: number;
  inProgressCount: number;
  notStartedCount: number;
  averageBand: number | null;
}

export interface AssignmentProgressStudent {
  student: {
    id: string;
    fullName: string;
    email: string;
  };
  status: "not_started" | "in_progress" | "submitted" | "expired";
  scores?: IAttemptScores;
  submittedAt?: Date;
}

export interface AssignmentProgressResult {
  assignment: {
    id: string;
    examTitle: string;
    deadline: Date | null;
    class: {
      id: string;
      name: string;
      code: string;
    } | null;
  };
  overview: TeacherAssignmentOverview;
  students: AssignmentProgressStudent[];
}

export async function getAssignmentsForTeacher(
  teacherId: string,
  role: string,
  filters: { classId?: string; page: number; limit: number }
): Promise<{
  assignments: unknown[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}> {
  const { classId, page, limit } = filters;
  const query: Record<string, unknown> = {};

  if (role !== "admin") {
    query.teacherId = teacherId;
  }

  if (classId) {
    query.classId = classId;
  }

  const skip = (page - 1) * limit;

  const [assignments, total] = await Promise.all([
    AssignmentModel.find(query)
      .populate("examId", "title durationMinutes")
      .populate("classId", "name code")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AssignmentModel.countDocuments(query),
  ]);

  return {
    assignments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getAssignmentProgress(
  assignmentId: string,
  userId: string,
  role: string
): Promise<AssignmentProgressResult> {
  const assignment = await AssignmentModel.findById(assignmentId)
    .populate("examId", "title durationMinutes")
    .populate("classId", "name code students");

  if (!assignment) {
    throw new NotFoundError("Bài tập không tồn tại.");
  }

  if (role !== "admin" && assignment.teacherId.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Không có quyền xem bài tập này.");
  }

  let studentList: Array<{ id: string; fullName: string; email: string }> = [];

  if (assignment.classId) {
    const classId =
      (assignment.classId as { _id?: Types.ObjectId })._id ?? assignment.classId;
    const cls = await ClassModel.findById(classId).populate<{
      students: Array<{ _id: Types.ObjectId; fullName: string; email: string }>;
    }>("students", "fullName email");

    if (cls && Array.isArray(cls.students)) {
      studentList = cls.students
        .filter((s) => Boolean(s && s._id))
        .map((s) => ({
          id: s._id.toString(),
          fullName: s.fullName,
          email: s.email,
        }));
    }
  } else if (assignment.studentId) {
    const student = await UserModel.findById(assignment.studentId).select("fullName email");
    if (student) {
      studentList = [
        {
          id: student._id.toString(),
          fullName: student.fullName,
          email: student.email,
        },
      ];
    }
  }

  const studentIds = studentList.map((s) => s.id);
  const targetExamId =
    (assignment.examId as { _id?: Types.ObjectId })._id ?? assignment.examId;

  const attempts =
    studentIds.length > 0
      ? await AttemptModel.find({
          examId: targetExamId,
          studentId: { $in: studentIds },
        })
      : [];

  const STATUS_PRIORITY: Record<string, number> = {
    not_started: 0,
    expired: 1,
    in_progress: 2,
    submitted: 3,
  };

  const students: AssignmentProgressStudent[] = studentList.map((student) => {
    const studentAttempts = attempts.filter(
      (a) => a.studentId.toString() === student.id
    );

    if (studentAttempts.length === 0) {
      return {
        student,
        status: "not_started",
      };
    }

    studentAttempts.sort((a, b) => {
      const isCurrentAssignA =
        a.assignmentId?.toString() === assignment._id.toString() ? 1 : 0;
      const isCurrentAssignB =
        b.assignmentId?.toString() === assignment._id.toString() ? 1 : 0;
      if (isCurrentAssignA !== isCurrentAssignB) {
        return isCurrentAssignB - isCurrentAssignA;
      }

      const prioA = STATUS_PRIORITY[a.status] ?? 0;
      const prioB = STATUS_PRIORITY[b.status] ?? 0;
      if (prioA !== prioB) {
        return prioB - prioA;
      }

      const timeA = (a.submittedAt ?? a.updatedAt ?? a.createdAt).getTime();
      const timeB = (b.submittedAt ?? b.updatedAt ?? b.createdAt).getTime();
      return timeB - timeA;
    });

    const bestAttempt = studentAttempts[0];
    const item: AssignmentProgressStudent = {
      student,
      status: bestAttempt.status,
    };

    if (bestAttempt.scores) {
      item.scores = bestAttempt.scores;
    }
    if (bestAttempt.submittedAt) {
      item.submittedAt = bestAttempt.submittedAt;
    }

    return item;
  });

  const totalStudents = studentList.length;
  let submittedCount = 0;
  let inProgressCount = 0;
  let notStartedCount = 0;

  for (const item of students) {
    if (item.status === "submitted") {
      submittedCount += 1;
    } else if (item.status === "in_progress") {
      inProgressCount += 1;
    } else if (item.status === "not_started") {
      notStartedCount += 1;
    }
  }

  const submittedBands = students
    .filter(
      (item) =>
        item.status === "submitted" &&
        typeof item.scores?.overallBand === "number" &&
        !Number.isNaN(item.scores.overallBand)
    )
    .map((item) => item.scores!.overallBand!);

  const averageBand =
    submittedBands.length > 0
      ? Math.round(
          (submittedBands.reduce((acc, val) => acc + val, 0) / submittedBands.length) * 10
        ) / 10
      : null;

  const overview: TeacherAssignmentOverview = {
    totalStudents,
    submittedCount,
    inProgressCount,
    notStartedCount,
    averageBand,
  };

  const examObj = assignment.examId as { _id?: Types.ObjectId; title?: string } | null;
  const classObj = assignment.classId as {
    _id?: Types.ObjectId;
    name?: string;
    code?: string;
  } | null;

  return {
    assignment: {
      id: assignment._id.toString(),
      examTitle: examObj?.title ?? "",
      deadline: assignment.deadline ?? null,
      class:
        classObj && classObj.name
          ? {
              id: (classObj._id ?? classObj).toString(),
              name: classObj.name,
              code: classObj.code ?? "",
            }
          : null,
    },
    overview,
    students,
  };
}
