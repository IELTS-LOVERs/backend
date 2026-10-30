import mongoose, { type Types } from "mongoose";
import { AttemptModel } from "../attempts/attempt.model.js";
import { getMyAttempts, type MyAttemptItem } from "../attempts/attempt.service.js";
import {
  getMyAssignments,
  type MyAssignment,
} from "../assignments/assignment.service.js";
import { ClassModel } from "../classes/class.model.js";
import { getPendingWritingSubmissions } from "../grading/grading.service.js";

export interface StudentDashboardStats {
  assignedCount: number;
  inProgressCount: number;
  submittedCount: number;
  averageBand: number | null;
  recentAttempts: MyAttemptItem[];
  upcomingAssignments: MyAssignment[];
}

export interface TeacherRecentSubmission {
  attemptId: string;
  studentId: string;
  studentName?: string;
  examTitle?: string;
  submittedAt: Date | null;
  overallBand: number | null;
  suspicious: boolean;
}

export interface TeacherDashboardStats {
  totalClasses: number;
  totalStudents: number;
  pendingGradingCount: number;
  averageScore: number | null;
  recentSubmissions: TeacherRecentSubmission[];
}

/**
 * Calculates the arithmetic mean of overall band scores, rounded to 1 decimal place.
 * Returns null if no valid scores are provided.
 */
export function calculateAverageBand(
  scores: Array<number | null | undefined>
): number | null {
  const validScores = scores.filter(
    (score): score is number => typeof score === "number" && !Number.isNaN(score)
  );

  if (validScores.length === 0) {
    return null;
  }

  const sum = validScores.reduce((acc, score) => acc + score, 0);
  return Math.round((sum / validScores.length) * 10) / 10;
}

export async function getStudentDashboard(
  studentId: string
): Promise<StudentDashboardStats> {
  const [assignments, inProgressCount, submittedCount, submittedAttempts, recentResult] =
    await Promise.all([
      getMyAssignments(studentId),
      AttemptModel.countDocuments({ studentId, status: "in_progress" }),
      AttemptModel.countDocuments({ studentId, status: { $in: ["submitted", "expired"] } }),
      AttemptModel.find({
        studentId,
        status: { $in: ["submitted", "expired"] },
        "scores.overallBand": { $ne: null },
        $or: [{ examKind: "mock" }, { examKind: { $exists: false } }],
      })
        .select("scores.overallBand")
        .lean(),
      getMyAttempts(studentId, { page: 1, limit: 5 }),
    ]);

  const assignedCount = assignments.filter(
    (item) => item.submissionStatus === "not_started"
  ).length;

  const bandScores = submittedAttempts.map(
    (attempt) => attempt.scores?.overallBand ?? null
  );
  const averageBand = calculateAverageBand(bandScores);

  const upcomingAssignments = assignments
    .filter((item) => item.submissionStatus !== "submitted")
    .slice(0, 5);

  return {
    assignedCount,
    inProgressCount,
    submittedCount,
    averageBand,
    recentAttempts: recentResult.items,
    upcomingAssignments,
  };
}

export async function getTeacherDashboard(
  userId: string,
  role: string
): Promise<TeacherDashboardStats> {
  const isAdmin = role === "admin";
  const classFilter = isAdmin ? {} : { teacherId: userId };

  const classes = await ClassModel.find(classFilter).select("_id students").lean();
  const totalClasses = classes.length;

  // Aggregate unique student IDs across managed classes
  const studentIdSet = new Set<string>();
  for (const cls of classes) {
    for (const student of cls.students ?? []) {
      studentIdSet.add(student.toString());
    }
  }
  const totalStudents = studentIdSet.size;

  const pendingGradingResult = await getPendingWritingSubmissions(userId, role);
  const pendingGradingCount = pendingGradingResult.totalPending;

  const studentObjectIds = Array.from(studentIdSet).map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  const attemptFilter: Record<string, unknown> = {
    status: { $in: ["submitted", "expired"] },
  };

  if (!isAdmin) {
    if (studentObjectIds.length > 0) {
      attemptFilter.studentId = { $in: studentObjectIds };
    } else {
      // If the teacher has no students yet, limit to empty match
      attemptFilter.studentId = { $in: [] };
    }
  }

  const [scoredAttempts, rawRecentSubmissions] = await Promise.all([
    AttemptModel.find({
      ...attemptFilter,
      "scores.overallBand": { $ne: null },
      $or: [{ examKind: "mock" }, { examKind: { $exists: false } }],
    })
      .select("scores.overallBand")
      .lean(),
    AttemptModel.find(attemptFilter)
      .populate("studentId", "fullName email")
      .populate("examId", "title")
      .sort({ submittedAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const bandScores = scoredAttempts.map(
    (attempt) => attempt.scores?.overallBand ?? null
  );
  const averageScore = calculateAverageBand(bandScores);

  const recentSubmissions: TeacherRecentSubmission[] = rawRecentSubmissions.map(
    (attempt) => {
      const studentDoc = attempt.studentId as unknown as {
        _id: Types.ObjectId;
        fullName?: string;
        email?: string;
      } | null;
      const examDoc = attempt.examId as unknown as {
        _id: Types.ObjectId;
        title?: string;
      } | null;

      return {
        attemptId: attempt._id.toString(),
        studentId: studentDoc?._id.toString() ?? attempt.studentId.toString(),
        studentName: studentDoc?.fullName ?? studentDoc?.email ?? "Unknown",
        examTitle: examDoc?.title ?? "Unknown Exam",
        submittedAt: attempt.submittedAt ?? null,
        overallBand: attempt.scores?.overallBand ?? null,
        suspicious: attempt.suspicious,
      };
    }
  );

  return {
    totalClasses,
    totalStudents,
    pendingGradingCount,
    averageScore,
    recentSubmissions,
  };
}
