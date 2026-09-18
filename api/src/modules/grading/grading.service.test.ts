import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import {
  assertTeacherOwnsAttempt,
  canTeacherGradeAttempt,
  countWords,
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
