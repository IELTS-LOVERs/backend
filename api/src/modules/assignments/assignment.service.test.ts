import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { AssignmentModel } from "./assignment.model.js";
import {
  deleteAssignment,
  exportAssignmentCsv,
  getAssignmentById,
  getAssignmentProgress,
  getAssignmentsForTeacher,
  getMyAssignments,
  resolveSubmissionStatuses,
  selectAssignmentAttempt,
  updateAssignment,
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
      deadline: new Date(Date.now() + 86_400_000),
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

describe("selectAssignmentAttempt", () => {
  it("returns null when there are no candidates", () => {
    expect(selectAssignmentAttempt([])).toBeNull();
  });

  it("prefers an in-progress attempt over a submitted one", () => {
    const result = selectAssignmentAttempt([
      { status: "submitted", submittedAt: new Date("2026-09-20") },
      { status: "in_progress" },
    ]);

    expect(result?.status).toBe("in_progress");
  });

  it("returns the most recently submitted attempt when none are in progress", () => {
    const result = selectAssignmentAttempt([
      { status: "submitted", submittedAt: new Date("2026-09-01") },
      { status: "submitted", submittedAt: new Date("2026-09-30") },
    ]);

    expect(result?.submittedAt).toEqual(new Date("2026-09-30"));
  });

  it("ignores expired attempts when a submitted one exists", () => {
    const result = selectAssignmentAttempt([
      { status: "expired" },
      { status: "submitted", submittedAt: new Date("2026-09-15") },
    ]);

    expect(result?.status).toBe("submitted");
  });
});

describe("getMyAssignments enrichment", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const assignmentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();
  const attemptId = new mongoose.Types.ObjectId();

  it("returns enriched cards with teacher, class, attempt and scores", async () => {
    vi.spyOn(ClassModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([{ _id: classId }]),
    } as never);

    const mockFind = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockResolvedValue([
        {
          _id: assignmentId,
          examId: { _id: examId, title: "Mock Exam", durationMinutes: 60 },
          teacherId: { _id: teacherId, fullName: "Teacher A" },
          classId: { _id: classId, name: "Class A" },
          deadline: new Date("2026-10-01"),
        },
      ]),
    };
    vi.spyOn(AssignmentModel, "find").mockReturnValueOnce(mockFind as never);

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([
        {
          _id: attemptId,
          assignmentId,
          examId,
          status: "submitted",
          scores: { overallBand: 7 },
          submittedAt: new Date("2026-09-20"),
        },
      ]),
    } as never);

    const result = await getMyAssignments(studentId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: assignmentId.toString(),
      examTitle: "Mock Exam",
      durationMinutes: 60,
      teacherName: "Teacher A",
      className: "Class A",
      attemptId: attemptId.toString(),
      scores: { overallBand: 7 },
      submissionStatus: "submitted",
    });
  });

  it("returns null attempt data and a personal class when nothing matches", async () => {
    vi.spyOn(ClassModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const mockFind = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockResolvedValue([
        {
          _id: assignmentId,
          examId: { _id: examId, title: "Solo Exam", durationMinutes: 45 },
          teacherId: { _id: teacherId, fullName: "Teacher B" },
          classId: null,
          deadline: null,
        },
      ]),
    };
    vi.spyOn(AssignmentModel, "find").mockReturnValueOnce(mockFind as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await getMyAssignments(studentId);

    expect(result[0].teacherName).toBe("Teacher B");
    expect(result[0].className).toBeNull();
    expect(result[0].attemptId).toBeNull();
    expect(result[0].scores).toBeNull();
    expect(result[0].submissionStatus).toBe("not_started");
  });
});

describe("getAssignmentById", () => {
  const assignmentId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when the assignment does not exist", async () => {
    vi.spyOn(AssignmentModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as never);

    await expect(
      getAssignmentById(assignmentId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError for a non-owner teacher", async () => {
    vi.spyOn(AssignmentModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockResolvedValue({
            _id: assignmentId,
            teacherId: { _id: new mongoose.Types.ObjectId(), fullName: "Other" },
            examId: { _id: examId, title: "E", durationMinutes: 60, status: "published" },
            classId: null,
            status: "active",
            assignedAt: new Date(),
          }),
        }),
      }),
    } as never);

    await expect(
      getAssignmentById(assignmentId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(ForbiddenError);
  });

  it("serializes the assignment detail for the owner", async () => {
    vi.spyOn(AssignmentModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({
          populate: vi.fn().mockResolvedValue({
            _id: assignmentId,
            teacherId: { _id: teacherId, fullName: "Teacher A" },
            examId: { _id: examId, title: "E", durationMinutes: 60, status: "published" },
            classId: { _id: classId, name: "Class A", code: "ABC123" },
            status: "active",
            deadline: new Date("2026-10-01"),
            assignedAt: new Date("2026-09-01"),
          }),
        }),
      }),
    } as never);

    const result = await getAssignmentById(
      assignmentId.toString(),
      teacherId.toString(),
      "teacher"
    );

    expect(result.id).toBe(assignmentId.toString());
    expect(result.exam).toEqual({
      id: examId.toString(),
      title: "E",
      durationMinutes: 60,
      status: "published",
    });
    expect(result.class).toEqual({ id: classId.toString(), name: "Class A", code: "ABC123" });
    expect(result.teacher).toEqual({ id: teacherId.toString(), fullName: "Teacher A" });
    expect(result.status).toBe("active");
  });
});

describe("updateAssignment", () => {
  const assignmentId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when the assignment does not exist", async () => {
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce(null as never);

    await expect(
      updateAssignment(assignmentId.toString(), teacherId.toString(), "teacher", {
        status: "archived",
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError for a non-owner teacher", async () => {
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce({
      _id: assignmentId,
      teacherId: new mongoose.Types.ObjectId(),
      status: "active",
      save: vi.fn(),
    } as never);

    await expect(
      updateAssignment(assignmentId.toString(), teacherId.toString(), "teacher", {
        status: "archived",
      })
    ).rejects.toThrow(ForbiddenError);
  });

  it("updates the deadline and status for the owner", async () => {
    const doc = {
      _id: assignmentId,
      teacherId,
      status: "active",
      deadline: undefined as Date | undefined,
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce(doc as never);

    const result = await updateAssignment(assignmentId.toString(), teacherId.toString(), "teacher", {
      deadline: "2026-12-01T00:00:00.000Z",
      status: "archived",
    });

    expect(result.status).toBe("archived");
    expect(result.deadline).toEqual(new Date("2026-12-01T00:00:00.000Z"));
    expect(doc.save).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAssignment", () => {
  const assignmentId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when the assignment does not exist", async () => {
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce(null as never);

    await expect(
      deleteAssignment(assignmentId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when students are still working on it", async () => {
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce({
      _id: assignmentId,
      teacherId,
    } as never);
    vi.spyOn(AttemptModel, "countDocuments").mockResolvedValueOnce(2 as never);

    await expect(
      deleteAssignment(assignmentId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(BadRequestError);
  });

  it("deletes the assignment for the owner when no active attempts exist", async () => {
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce({
      _id: assignmentId,
      teacherId,
    } as never);
    vi.spyOn(AttemptModel, "countDocuments").mockResolvedValueOnce(0 as never);
    const deleteSpy = vi
      .spyOn(AssignmentModel, "deleteOne")
      .mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 } as never);

    const result = await deleteAssignment(
      assignmentId.toString(),
      teacherId.toString(),
      "teacher"
    );

    expect(result.message).toBe("Đã xóa bài tập thành công");
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });
});

describe("exportAssignmentCsv", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const assignmentId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();

  it("renders a CSV row with scores and suspicious flag", async () => {
    vi.spyOn(AssignmentModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
          _id: assignmentId,
          teacherId,
          examId: { _id: examId, title: "Mock Exam" },
          classId: { _id: classId, name: "Class 1", code: "CLS1" },
          deadline: new Date("2026-10-01"),
        }),
      }),
    } as never);

    vi.spyOn(ClassModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue({
        students: [
          { _id: studentId, fullName: "Student One", email: "s1@test.com" },
        ],
      }),
    } as never);

    vi.spyOn(AttemptModel, "find").mockResolvedValue([
      {
        studentId,
        examId,
        assignmentId,
        status: "submitted",
        suspicious: true,
        scores: { listeningBand: 6.5, overallBand: 6.5 },
        submittedAt: new Date("2026-09-18T00:00:00Z"),
      },
    ] as never);

    const csv = await exportAssignmentCsv(
      assignmentId.toString(),
      teacherId.toString(),
      "teacher"
    );
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "Student,Email,Status,Listening,Reading,Writing,Overall,SubmittedAt,Suspicious"
    );
    expect(lines[1]).toContain("Student One");
    expect(lines[1]).toContain("s1@test.com");
    expect(lines[1]).toContain("6.5");
    expect(lines[1].endsWith(",yes")).toBe(true);
  });
});
