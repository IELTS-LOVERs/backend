import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { AssignmentModel } from "./assignment.model.js";
import {
  getAssignmentProgress,
  getAssignmentsForTeacher,
  resolveSubmissionStatuses,
} from "./assignment.service.js";

describe("resolveSubmissionStatuses", () => {
  it("returns nothing when the student has no attempts", () => {
    const statuses = resolveSubmissionStatuses([]);

    expect(statuses.size).toBe(0);
  });

  it("maps in-progress and expired attempts per exam", () => {
    const statuses = resolveSubmissionStatuses([
      { examId: "exam-1", status: "in_progress" },
      { examId: "exam-2", status: "expired" },
    ]);

    expect(statuses.get("exam-1")).toBe("in_progress");
    expect(statuses.get("exam-2")).toBe("expired");
  });

  it("prefers submitted over in_progress and expired", () => {
    const statuses = resolveSubmissionStatuses([
      { examId: "exam-1", status: "expired" },
      { examId: "exam-1", status: "in_progress" },
      { examId: "exam-1", status: "submitted" },
    ]);

    expect(statuses.get("exam-1")).toBe("submitted");
  });

  it("prefers in_progress over expired", () => {
    const statuses = resolveSubmissionStatuses([
      { examId: "exam-1", status: "expired" },
      { examId: "exam-1", status: "in_progress" },
    ]);

    expect(statuses.get("exam-1")).toBe("in_progress");
  });

  it("records submission status by assignmentId when provided", () => {
    const statuses = resolveSubmissionStatuses([
      { assignmentId: "assign-1", examId: "exam-1", status: "submitted" },
      { assignmentId: "assign-2", examId: "exam-1", status: "in_progress" },
    ]);

    expect(statuses.get("assign-1")).toBe("submitted");
    expect(statuses.get("assign-2")).toBe("in_progress");
    expect(statuses.get("exam-1")).toBe("submitted");
  });
});

describe("getAssignmentsForTeacher", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();

  it("filters by teacherId for teacher role", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const mockFind = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ _id: "a1" }]),
    };

    vi.spyOn(AssignmentModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return mockFind as never;
    });
    vi.spyOn(AssignmentModel, "countDocuments").mockResolvedValueOnce(1 as never);

    const result = await getAssignmentsForTeacher(teacherId, "teacher", {
      classId: "c1",
      page: 1,
      limit: 10,
    });

    expect(capturedQuery?.teacherId).toBe(teacherId);
    expect(capturedQuery?.classId).toBe("c1");
    expect(result.assignments).toHaveLength(1);
    expect(result.meta.totalPages).toBe(1);
  });

  it("does not filter by teacherId for admin role", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const mockFind = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(AssignmentModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return mockFind as never;
    });
    vi.spyOn(AssignmentModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await getAssignmentsForTeacher("admin-id", "admin", {
      page: 1,
      limit: 20,
    });

    expect(capturedQuery?.teacherId).toBeUndefined();
  });
});

describe("getAssignmentProgress", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const assignmentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when assignment does not exist", async () => {
    // Make findById chainable with 2 populates and resolve to null
    vi.spyOn(AssignmentModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(null),
      }),
    } as never);

    await expect(
      getAssignmentProgress(assignmentId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError when teacher does not own the assignment", async () => {
    const mockAssignment = {
      _id: assignmentId,
      teacherId: new mongoose.Types.ObjectId(), // different teacher
      examId: { _id: examId, title: "IELTS Exam" },
      classId: { _id: classId, name: "IELTS A", code: "IELTA" },
    };

    vi.spyOn(AssignmentModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAssignment),
      }),
    } as never);

    await expect(
      getAssignmentProgress(assignmentId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(ForbiddenError);
  });

  it("calculates overview and student statuses correctly for class assignments", async () => {
    const s1Id = new mongoose.Types.ObjectId();
    const s2Id = new mongoose.Types.ObjectId();
    const s3Id = new mongoose.Types.ObjectId();

    const mockAssignment = {
      _id: assignmentId,
      teacherId,
      examId: { _id: examId, title: "Mock Exam" },
      classId: { _id: classId, name: "Class 1", code: "CLS1" },
      deadline: new Date("2026-10-01"),
    };

    vi.spyOn(AssignmentModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAssignment),
      }),
    } as never);

    vi.spyOn(ClassModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue({
        students: [
          { _id: s1Id, fullName: "Student One", email: "s1@test.com" },
          { _id: s2Id, fullName: "Student Two", email: "s2@test.com" },
          { _id: s3Id, fullName: "Student Three", email: "s3@test.com" },
        ],
      }),
    } as never);

    const attempts = [
      {
        studentId: s1Id,
        examId,
        assignmentId,
        status: "submitted",
        scores: { overallBand: 7.5 },
        submittedAt: new Date("2026-09-18T00:00:00Z"),
      },
      {
        studentId: s2Id,
        examId,
        assignmentId,
        status: "in_progress",
        createdAt: new Date("2026-09-18T01:00:00Z"),
      },
    ];

    vi.spyOn(AttemptModel, "find").mockResolvedValue(attempts as never);

    const result = await getAssignmentProgress(
      assignmentId.toString(),
      teacherId.toString(),
      "teacher"
    );

    expect(result.assignment.id).toBe(assignmentId.toString());
    expect(result.assignment.examTitle).toBe("Mock Exam");
    expect(result.assignment.class?.name).toBe("Class 1");

    expect(result.overview.totalStudents).toBe(3);
    expect(result.overview.submittedCount).toBe(1);
    expect(result.overview.inProgressCount).toBe(1);
    expect(result.overview.notStartedCount).toBe(1);
    expect(result.overview.averageBand).toBe(7.5);

    expect(result.students).toHaveLength(3);
    expect(result.students[0].status).toBe("submitted");
    expect(result.students[0].scores?.overallBand).toBe(7.5);
    expect(result.students[1].status).toBe("in_progress");
    expect(result.students[2].status).toBe("not_started");
  });
});
