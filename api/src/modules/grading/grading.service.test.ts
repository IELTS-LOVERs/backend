import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { WritingReviewModel } from "./writing-review.model.js";
import {
  assertTeacherOwnsAttempt,
  canTeacherGradeAttempt,
  countWords,
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
