import type { Types } from "mongoose";
import { env } from "../../config/env.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import type { IExam } from "./exam.model.js";

export async function getAssignedExamIds(studentId: string): Promise<Types.ObjectId[]> {
  const classes = await ClassModel.find({ students: studentId }).select("_id");
  const classIds = classes.map((cls) => cls._id);

  const assignments = await AssignmentModel.find({
    status: "active",
    $or: [{ classId: { $in: classIds } }, { studentId }],
  }).select("examId");

  return assignments.map((assignment) => assignment.examId);
}

async function studentHasAttempt(studentId: string, examId: Types.ObjectId): Promise<boolean> {
  const attempt = await AttemptModel.exists({
    studentId,
    examId,
    status: { $in: ["in_progress", "submitted", "expired"] },
  });
  return Boolean(attempt);
}

export async function canStudentAccessExam(
  studentId: string,
  exam: IExam
): Promise<boolean> {
  if (exam.status !== "published" && exam.status !== "closed") return false;

  // Đề đã đóng vẫn phải mở được cho học sinh đã làm bài để xem lại kết quả.
  if (exam.status === "closed") {
    return studentHasAttempt(studentId, exam._id);
  }

  if (exam.kind === "practice") return true;
  if (!env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT) return true; // giữ hành vi dev hiện tại

  const assigned = await getAssignedExamIds(studentId);
  if (assigned.some((id) => id.equals(exam._id))) return true;

  // Assignment có thể đã bị archive sau khi học sinh nộp bài. Vẫn cho xem lại.
  return studentHasAttempt(studentId, exam._id);
}
