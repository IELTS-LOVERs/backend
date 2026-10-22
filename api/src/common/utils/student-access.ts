import mongoose from "mongoose";
import { AssignmentModel } from "../../modules/assignments/assignment.model.js";
import { ClassModel } from "../../modules/classes/class.model.js";

/**
 * Shared authorization rule for teacher/admin access to a student's progress.
 *
 * - Admin: can inspect any valid student id.
 * - Teacher: must own a class containing the student, or have created an
 *   assignment targeted directly at that student.
 * - Student: only their own id (callers still enforce this separately).
 */
export async function canStaffViewStudent(
  viewer: { id: string; role: string },
  studentId: string
): Promise<boolean> {
  if (viewer.role === "admin") {
    return mongoose.isValidObjectId(studentId);
  }

  if (viewer.role !== "teacher") {
    return viewer.id === studentId;
  }

  if (
    !mongoose.isValidObjectId(viewer.id) ||
    !mongoose.isValidObjectId(studentId)
  ) {
    return false;
  }

  const [classExists, assignmentExists] = await Promise.all([
    ClassModel.exists({
      teacherId: new mongoose.Types.ObjectId(viewer.id),
      students: new mongoose.Types.ObjectId(studentId),
    }),
    AssignmentModel.exists({
      teacherId: new mongoose.Types.ObjectId(viewer.id),
      studentId: new mongoose.Types.ObjectId(studentId),
    }),
  ]);

  return Boolean(classExists || assignmentExists);
}
