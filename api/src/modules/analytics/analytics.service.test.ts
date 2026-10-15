import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import { AttemptModel } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "../exams/exam.model.js";
import { UserModel } from "../users/user.model.js";
import {
  getClassAnalytics,
  getExamAnalytics,
  getStudentProgress,
} from "./analytics.service.js";

describe("getExamAnalytics", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const examId = new mongoose.Types.ObjectId();
  const q1 = new mongoose.Types.ObjectId();
  const q2 = new mongoose.Types.ObjectId();

  function mockExam(createdBy: mongoose.Types.ObjectId = teacherId) {
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
      _id: examId,
      title: "Mock",
      status: "published",
      createdBy,
      sections: [
        {
          skill: "listening",
          part: 1,
          title: "S1",
          questionGroups: [
            {
              groupType: "form_completion",
              config: {},
              questions: [
                {
                  _id: q1,
                  questionNumber: 1,
                  prompt: "Q1",
                  acceptedAnswers: ["london"],
                  points: 1,
                },
                {
                  _id: q2,
                  questionNumber: 2,
                  prompt: "Q2",
                  acceptedAnswers: ["paris"],
                  points: 1,
                },
              ],
            },
          ],
        },
      ],
    } as never);
  }

  it("throws ForbiddenError for a non-owner teacher", async () => {
    mockExam(new mongoose.Types.ObjectId());

    await expect(
      getExamAnalytics(examId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(ForbiddenError);
  });

  it("aggregates section accuracy, hardest questions and band distribution", async () => {
    mockExam();
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(),
          answers: [{ questionId: q1, value: "London" }],
          scores: { overallBand: 6.5 },
        },
        {
          _id: new mongoose.Types.ObjectId(),
          answers: [
            { questionId: q1, value: "Berlin" },
            { questionId: q2, value: "Paris" },
          ],
          scores: { overallBand: 7 },
        },
      ]),
    } as never);

    const result = await getExamAnalytics(examId.toString(), teacherId.toString(), "teacher");

    expect(result.totalAttempts).toBe(2);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].answered).toBe(3);
    expect(result.sections[0].correct).toBe(2);
    expect(result.sections[0].accuracy).toBeCloseTo(2 / 3);
    expect(result.hardestQuestions[0].questionId).toBe(q1.toString());
    expect(result.bandDistribution).toEqual([
      { band: 6.5, count: 1 },
      { band: 7, count: 1 },
    ]);
    expect(result.averageOverallBand).toBe(6.8);
  });
});

describe("getClassAnalytics", () => {
  const teacherId = new mongoose.Types.ObjectId();
  const classId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();

  it("throws ForbiddenError for a non-owner teacher", async () => {
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce({
      _id: classId,
      teacherId: new mongoose.Types.ObjectId(),
      students: [],
    } as never);

    await expect(
      getClassAnalytics(classId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(ForbiddenError);
  });

  it("computes per-student and class skill averages", async () => {
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce({
      _id: classId,
      name: "IELTS 10A",
      code: "ABC123",
      teacherId,
      students: [studentId],
    } as never);
    vi.spyOn(UserModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([
        { _id: studentId, fullName: "Student One", email: "s1@test.com" },
      ]),
    } as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue([
        {
          studentId,
          scores: { listeningBand: 6.5, readingBand: 6, writingBand: 5.5, overallBand: 6 },
        },
        { studentId, scores: { listeningBand: 7.5, overallBand: 7 } },
      ]),
    } as never);

    const result = await getClassAnalytics(classId.toString(), teacherId.toString(), "teacher");

    expect(result.class.name).toBe("IELTS 10A");
    expect(result.totalStudents).toBe(1);
    expect(result.students[0].listening).toBe(7);
    expect(result.students[0].reading).toBe(6);
    expect(result.students[0].overall).toBe(6.5);
    expect(result.classAverages.listening).toBe(7);
    expect(result.classAverages.overall).toBe(6.5);
  });
});

describe("getStudentProgress", () => {
  const studentId = new mongoose.Types.ObjectId().toString();

  it("forces the authenticated student id and computes delta against targetBand", async () => {
    vi.spyOn(UserModel, "findById").mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ targetBand: 7 }),
    } as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              _id: new mongoose.Types.ObjectId(),
              examId: { _id: new mongoose.Types.ObjectId(), title: "E1" },
              submittedAt: new Date("2026-01-01"),
              scores: { overallBand: 6, listeningBand: 6 },
            },
            {
              _id: new mongoose.Types.ObjectId(),
              examId: null,
              submittedAt: new Date("2026-02-01"),
              scores: { overallBand: 6.5, readingBand: 7 },
            },
          ]),
        }),
      }),
    } as never);

    const result = await getStudentProgress(
      { id: studentId, role: "student" },
      { studentId: "another-student", limit: 20 }
    );

    expect(result.studentId).toBe(studentId);
    expect(result.latest.overall).toBe(6.5);
    expect(result.latest.listening).toBe(6);
    expect(result.latest.reading).toBe(7);
    expect(result.deltaFromTarget).toBe(-0.5);
    expect(result.points).toHaveLength(2);
  });
});
