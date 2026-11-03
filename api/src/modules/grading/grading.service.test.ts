import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { WritingReviewModel } from "./writing-review.model.js";
import { ExamModel } from "../exams/exam.model.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import {
  assertTeacherOwnsAttempt,
  canTeacherGradeAttempt,
  countWords,
  getPendingWritingSubmissions,
  gradeWriting,
} from "./grading.service.js";

describe("countWords", () => {
  it("returns 0 for empty or blank strings", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\t  \n")).toBe(0);
  });

  it("counts words separated by spaces, newlines and repeated whitespace", () => {
    expect(countWords("The quick brown fox")).toBe(4);
    expect(countWords("  hello\n\nworld\tagain  ")).toBe(3);
  });
});

describe("canTeacherGradeAttempt", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();
  const otherTeacherId = new mongoose.Types.ObjectId().toString();
  const strangerId = new mongoose.Types.ObjectId().toString();

  const attempt = {
    examId: {
      _id: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(teacherId),
    },
    assignmentId: {
      _id: new mongoose.Types.ObjectId(),
      teacherId: new mongoose.Types.ObjectId(otherTeacherId),
    },
  };

  it("lets admins grade any attempt", () => {
    expect(canTeacherGradeAttempt({ examId: null }, strangerId, "admin")).toBe(true);
  });

  it("lets the exam owner grade", () => {
    expect(canTeacherGradeAttempt(attempt, teacherId, "teacher")).toBe(true);
  });

  it("lets the assignment owner grade even when the exam belongs to someone else", () => {
    expect(canTeacherGradeAttempt(attempt, otherTeacherId, "teacher")).toBe(true);
  });

  it("rejects a teacher with no ownership", () => {
    expect(canTeacherGradeAttempt(attempt, strangerId, "teacher")).toBe(false);
  });

  it("throws ForbiddenError through assertTeacherOwnsAttempt", () => {
    expect(() => assertTeacherOwnsAttempt(attempt, strangerId, "teacher")).toThrow(
      ForbiddenError
    );
  });
});

describe("gradeWriting", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();
  const attemptId = new mongoose.Types.ObjectId().toString();

  it("calculates overall score when only task 1 is provided", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: new mongoose.Types.ObjectId(),
      status: "submitted",
      examId: { createdBy: new mongoose.Types.ObjectId(teacherId) },
      scores: {},
      save: vi.fn(),
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);
    vi.spyOn(WritingReviewModel, "findOneAndUpdate").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
    } as never);

    const result = await gradeWriting(
      {
        attemptId,
        task1: { score: 6.5, comment: "Good task 1" },
      },
      teacherId,
      "teacher"
    );

    expect(result.overallWritingScore).toBe(6.5);
    expect(result.task1Score).toBe(6.5);
    expect(result.task2Score).toBeUndefined();
    expect(mockAttempt.scores.writingTask1Band).toBe(6.5);
    expect(mockAttempt.scores.writingBand).toBe(6.5);
  });

  it("calculates overall score when only task 2 is provided", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: new mongoose.Types.ObjectId(),
      status: "submitted",
      examId: { createdBy: new mongoose.Types.ObjectId(teacherId) },
      scores: {},
      save: vi.fn(),
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);
    vi.spyOn(WritingReviewModel, "findOneAndUpdate").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
    } as never);

    const result = await gradeWriting(
      {
        attemptId,
        task2: { score: 7.0, comment: "Good task 2" },
      },
      teacherId,
      "teacher"
    );

    expect(result.overallWritingScore).toBe(7.0);
    expect(result.task2Score).toBe(7.0);
    expect(result.task1Score).toBeUndefined();
    expect(mockAttempt.scores.writingTask2Band).toBe(7.0);
    expect(mockAttempt.scores.writingBand).toBe(7.0);
  });

  it("calculates overall score when both tasks are provided", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: new mongoose.Types.ObjectId(),
      status: "submitted",
      examId: { createdBy: new mongoose.Types.ObjectId(teacherId) },
      scores: {},
      save: vi.fn(),
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);
    vi.spyOn(WritingReviewModel, "findOneAndUpdate").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
    } as never);

    const result = await gradeWriting(
      {
        attemptId,
        task1: { score: 6.0 },
        task2: { score: 7.0 },
      },
      teacherId,
      "teacher"
    );

    // Task 1 weight 1, Task 2 weight 2: (6.0 + 14.0) / 3 = 6.666 -> rounded to 6.5
    expect(result.overallWritingScore).toBe(6.5);
    expect(result.task1Score).toBe(6.0);
    expect(result.task2Score).toBe(7.0);
  });
});

describe("getPendingWritingSubmissions", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();

  it("returns empty result when no exams have writing skill", async () => {
    vi.spyOn(ExamModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const result = await getPendingWritingSubmissions(teacherId, "teacher");

    expect(result.items).toHaveLength(0);
    expect(result.totalPending).toBe(0);
  });

  it("returns unreviewed pending writing submissions with pagination", async () => {
    const examId1 = new mongoose.Types.ObjectId();
    const examId2 = new mongoose.Types.ObjectId();
    const attemptId1 = new mongoose.Types.ObjectId();
    const attemptId2 = new mongoose.Types.ObjectId();
    const reviewedAttemptId = new mongoose.Types.ObjectId();
    const student1 = { _id: new mongoose.Types.ObjectId(), fullName: "Alice", email: "alice@test.com" };
    const student2 = { _id: new mongoose.Types.ObjectId(), fullName: "Bob", email: "bob@test.com" };

    vi.spyOn(ExamModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([
          { _id: examId1, title: "Writing Test 1", createdBy: new mongoose.Types.ObjectId(teacherId) },
          { _id: examId2, title: "Writing Test 2", createdBy: new mongoose.Types.ObjectId() },
        ]),
      }),
    } as never);

    vi.spyOn(AssignmentModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const mockAttempts = [
      {
        _id: attemptId1,
        examId: examId1,
        studentId: student1,
        submittedAt: new Date("2026-09-01"),
        suspicious: false,
      },
      {
        _id: reviewedAttemptId,
        examId: examId1,
        studentId: student1,
        submittedAt: new Date("2026-09-02"),
        suspicious: false,
      },
      {
        _id: attemptId2,
        examId: examId1,
        studentId: student2,
        submittedAt: new Date("2026-09-03"),
        suspicious: true,
      },
    ];

    const mockSelect = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockAttempts),
      }),
    };

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValue(mockSelect),
    } as never);

    vi.spyOn(WritingReviewModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([{ attemptId: reviewedAttemptId }]),
      }),
    } as never);

    const result = await getPendingWritingSubmissions(teacherId, "teacher", {
      page: 1,
      limit: 1,
    });

    expect(result.totalPending).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      attemptId: attemptId1.toString(),
      studentName: "Alice",
      examTitle: "Writing Test 1",
      hasSuspiciousActivity: false,
    });
  });

  it("lets admin view all pending writing submissions without teacher ownership check", async () => {
    const examId = new mongoose.Types.ObjectId();
    const attemptId = new mongoose.Types.ObjectId();

    vi.spyOn(ExamModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([
          { _id: examId, title: "Admin Writing Exam", createdBy: new mongoose.Types.ObjectId() },
        ]),
      }),
    } as never);

    const mockSelect = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          {
            _id: attemptId,
            examId,
            studentId: { fullName: "Charlie", email: "charlie@test.com" },
            submittedAt: new Date("2026-09-05"),
            suspicious: false,
          },
        ]),
      }),
    };

    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValue(mockSelect),
    } as never);

    vi.spyOn(WritingReviewModel, "find").mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        lean: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const result = await getPendingWritingSubmissions("admin-id", "admin");

    expect(result.totalPending).toBe(1);
    expect(result.items[0].studentName).toBe("Charlie");
  });
});

