import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { env } from "../../config/env.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { ExamModel, type IExam } from "../exams/exam.model.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { WritingReviewModel } from "../grading/writing-review.model.js";
import { AttemptModel, type IAttemptAnswer } from "./attempt.model.js";
import {
  applyQuestionOrder,
  buildCandidateExam,
  canAccessAttemptResult,
  collectCandidateQuestionIds,
  collectExamQuestionBuckets,
  computeRemainingSeconds,
  getAttemptForRecovery,
  getAttemptResult,
  gradeQuestions,
  shuffleQuestionIds,
  startAttempt,
  submitAttempt,
  type CandidateExam,
  type RawExamObject,
  type RawPopulatedQuestion,
} from "./attempt.service.js";

function makeQuestion(
  overrides: Partial<RawPopulatedQuestion> = {}
): RawPopulatedQuestion {
  return {
    _id: new mongoose.Types.ObjectId(),
    skill: "listening",
    type: "form_completion",
    part: 1,
    prompt: "Write the answer.",
    data: {},
    acceptedAnswers: ["secret-answer"],
    points: 1,
    explanation: "secret-explanation",
    mediaIds: [],
    ...overrides,
  };
}

describe("computeRemainingSeconds", () => {
  it("floors the remaining duration in seconds", () => {
    const now = Date.now();
    const expiresAt = new Date(now + 90_500);

    expect(computeRemainingSeconds(expiresAt, now)).toBe(90);
  });

  it("never returns a negative value", () => {
    const now = Date.now();
    const expiresAt = new Date(now - 5_000);

    expect(computeRemainingSeconds(expiresAt, now)).toBe(0);
  });
});

describe("buildCandidateExam", () => {
  const examStub = {
    toObject: () => ({
      _id: new mongoose.Types.ObjectId(),
      title: "IELTS Mock 01",
      sections: [
        {
          skill: "listening",
          part: 1,
          title: "Section 1",
          instructions: "Answer questions 1-10.",
          passageText: undefined,
          mediaIds: [new mongoose.Types.ObjectId()],
          questionIds: [makeQuestion({ points: 2 })],
        },
      ],
    }),
  } as unknown as IExam;

  it("strips acceptedAnswers and explanation from every question", () => {
    const candidate = buildCandidateExam(examStub);
    const serialized = JSON.stringify(candidate);

    expect(serialized).not.toContain("acceptedAnswers");
    expect(serialized).not.toContain("explanation");
    expect(serialized).not.toContain("secret-answer");
    expect(serialized).not.toContain("secret-explanation");
  });

  it("keeps the candidate-facing question fields", () => {
    const candidate = buildCandidateExam(examStub);
    const question = candidate.sections[0].questions[0];

    expect(candidate.title).toBe("IELTS Mock 01");
    expect(candidate.sections[0].skill).toBe("listening");
    expect(question.prompt).toBe("Write the answer.");
    expect(question.points).toBe(2);
    expect(question.content).toBeNull();
  });

  it("populates media URLs for section and question media", () => {
    const sectionMediaDoc = {
      _id: new mongoose.Types.ObjectId(),
      key: "audio/test.mp3",
      type: "audio" as const,
      originalName: "test.mp3",
    };
    const questionMediaDoc = {
      _id: new mongoose.Types.ObjectId(),
      key: "images/diagram.png",
      type: "image" as const,
      originalName: "diagram.png",
    };

    const examWithMedia = {
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        title: "Media Exam",
        sections: [
          {
            skill: "listening",
            part: 1,
            title: "Section 1",
            instructions: "Listen",
            passageText: null,
            mediaIds: [sectionMediaDoc],
            questionIds: [makeQuestion({ mediaIds: [questionMediaDoc] })],
          },
        ],
      }),
    } as unknown as IExam;

    const candidate = buildCandidateExam(examWithMedia);
    expect(candidate.sections[0].media).toHaveLength(1);
    expect(candidate.sections[0].media[0].url).toContain("audio/test.mp3");
    expect(candidate.sections[0].media[0].type).toBe("audio");
    expect(candidate.sections[0].questions[0].media).toHaveLength(1);
    expect(candidate.sections[0].questions[0].media[0].url).toContain("images/diagram.png");
    expect(candidate.sections[0].questions[0].media[0].type).toBe("image");
  });
});

describe("gradeQuestions", () => {
  const matchedId = new mongoose.Types.ObjectId();
  const missedId = new mongoose.Types.ObjectId();

  const answers: Pick<IAttemptAnswer, "questionId" | "value">[] = [
    { questionId: matchedId, value: "  LONDON " },
    { questionId: missedId, value: "Paris" },
  ];

  it("respects per-question points and normalizes answers", () => {
    const rawScore = gradeQuestions(answers, [
      { _id: matchedId, acceptedAnswers: ["london"], points: 2 },
      { _id: missedId, acceptedAnswers: ["Berlin"], points: 3 },
    ]);

    expect(rawScore).toBe(2);
  });

  it("does not score unanswered questions", () => {
    const rawScore = gradeQuestions([], [
      { _id: matchedId, acceptedAnswers: ["london"], points: 1 },
    ]);

    expect(rawScore).toBe(0);
  });
});

describe("collectExamQuestionBuckets", () => {
  it("is skill-aware: only flags and grades skills present in the exam", () => {
    const examObj: RawExamObject = {
      _id: new mongoose.Types.ObjectId(),
      title: "Writing only",
      sections: [
        {
          skill: "writing",
          part: 1,
          title: "Task 1",
          questionIds: [makeQuestion({ skill: "writing", type: "writing_task_1" })],
        },
      ],
    };

    const buckets = collectExamQuestionBuckets(examObj);

    expect(buckets.hasWriting).toBe(true);
    expect(buckets.hasListening).toBe(false);
    expect(buckets.hasReading).toBe(false);
    expect(buckets.listening).toHaveLength(0);
    expect(buckets.reading).toHaveLength(0);
  });

  it("separates listening and reading questions", () => {
    const examObj: RawExamObject = {
      _id: new mongoose.Types.ObjectId(),
      title: "L/R",
      sections: [
        {
          skill: "listening",
          part: 1,
          title: "L1",
          questionIds: [makeQuestion({ skill: "listening" })],
        },
        {
          skill: "reading",
          part: 1,
          title: "R1",
          questionIds: [makeQuestion({ skill: "reading" })],
        },
      ],
    };

    const buckets = collectExamQuestionBuckets(examObj);

    expect(buckets.hasListening).toBe(true);
    expect(buckets.hasReading).toBe(true);
    expect(buckets.hasWriting).toBe(false);
    expect(buckets.listening).toHaveLength(1);
    expect(buckets.reading).toHaveLength(1);
  });
});

describe("canAccessAttemptResult", () => {
  it("allows admin to access any attempt result", () => {
    expect(
      canAccessAttemptResult("student-123", { id: "admin-1", role: "admin" })
    ).toBe(true);
  });

  it("allows teacher to access any attempt result", () => {
    expect(
      canAccessAttemptResult("student-123", { id: "teacher-1", role: "teacher" })
    ).toBe(true);
  });

  it("allows student to access their own attempt result", () => {
    expect(
      canAccessAttemptResult("student-123", { id: "student-123", role: "student" })
    ).toBe(true);
  });

  it("denies student accessing another student's attempt result", () => {
    expect(
      canAccessAttemptResult("student-123", { id: "student-456", role: "student" })
    ).toBe(false);
  });
});

describe("getAttemptResult permissions", () => {
  const attemptId = new mongoose.Types.ObjectId();
  const studentOwnerId = new mongoose.Types.ObjectId();
  const strangerStudentId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when attempt does not exist", async () => {
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(null),
      }),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: studentOwnerId.toString(), role: "student" })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError (ATTEMPT_NOT_OWNED) when student does not own attempt", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: studentOwnerId,
      status: "submitted",
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAttempt),
      }),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: strangerStudentId.toString(), role: "student" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows the exam owner teacher to access a student attempt", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: studentOwnerId,
      status: "in_progress", // not submitted, will throw EXAM_NOT_SUBMITTED, proving it passed permission check
      examId: { _id: new mongoose.Types.ObjectId(), createdBy: teacherId },
      assignmentId: null,
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAttempt),
      }),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: teacherId.toString(), role: "teacher" })
    ).rejects.toThrow("Bài thi chưa được nộp.");
  });

  it("denies a teacher who owns neither the exam nor the assignment", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: studentOwnerId,
      status: "submitted",
      examId: { _id: new mongoose.Types.ObjectId(), createdBy: new mongoose.Types.ObjectId() },
      assignmentId: null,
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAttempt),
      }),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: teacherId.toString(), role: "teacher" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows admin to access student attempt without ATTEMPT_NOT_OWNED error", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: studentOwnerId,
      status: "in_progress",
      examId: { _id: new mongoose.Types.ObjectId(), createdBy: new mongoose.Types.ObjectId() },
      assignmentId: null,
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAttempt),
      }),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: adminId.toString(), role: "admin" })
    ).rejects.toThrow("Bài thi chưa được nộp.");
  });
});

describe("startAttempt guards", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const examId = new mongoose.Types.ObjectId().toString();
  const assignmentId = new mongoose.Types.ObjectId().toString();

  it("throws BadRequestError (EXAM_NOT_OPENED) when current time is before openAt", async () => {
    const futureOpenAt = new Date(Date.now() + 3_600_000);
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
      _id: examId,
      status: "published",
      openAt: futureOpenAt,
    } as never);

    await expect(startAttempt(studentId, examId)).rejects.toThrow(BadRequestError);
  });

  it("throws BadRequestError (EXAM_CLOSED) when current time is after closeAt", async () => {
    const pastCloseAt = new Date(Date.now() - 3_600_000);
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
      _id: examId,
      status: "published",
      closeAt: pastCloseAt,
    } as never);

    await expect(startAttempt(studentId, examId)).rejects.toThrow(BadRequestError);
  });

  it("throws BadRequestError (ASSIGNMENT_MAX_ATTEMPTS_REACHED) when the student used all attempts", async () => {
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
      _id: examId,
      status: "published",
    } as never);
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce({
      _id: assignmentId,
      status: "active",
      examId,
      maxAttempts: 1,
    } as never);
    vi.spyOn(AttemptModel, "countDocuments").mockResolvedValueOnce(1 as never);

    await expect(startAttempt(studentId, examId, assignmentId)).rejects.toThrow(BadRequestError);
  });

  it("throws ASSIGNMENT_REQUIRED when flag enabled and no assignmentId is given", async () => {
    const original = env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT;
    env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT = true;

    try {
      vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
        _id: examId,
        status: "published",
      } as never);

      await expect(startAttempt(studentId, examId)).rejects.toThrow(/bài tập được giao/);
    } finally {
      env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT = original;
    }
  });
});

describe("auto-finalize when expired", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const examId = new mongoose.Types.ObjectId().toString();
  const attemptId = new mongoose.Types.ObjectId().toString();
  const expiredAt = new Date(Date.now() - 100_000);

  it("auto-finalizes expired attempt on submit without throwing 403", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId,
      examId,
      status: "in_progress",
      expiresAt: expiredAt,
      answers: [],
      scores: {},
      save: vi.fn(),
    };
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(mockAttempt as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
          toObject: () => ({
            _id: examId,
            sections: [],
          }),
        }),
      }),
    } as never);
    vi.spyOn(AttemptModel, "findOneAndUpdate").mockResolvedValueOnce({
      _id: attemptId,
      status: "expired",
      submittedAt: expiredAt,
      scores: {},
    } as never);

    const result = await submitAttempt(attemptId, studentId);
    expect(result.status).toBe("expired");
    expect(result.message).toBeDefined();
    expect(result.submittedAt).toEqual(expiredAt);
  });

  it("auto-finalizes expired attempt on getAttemptForRecovery when remainingSeconds <= 0", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId,
      examId,
      status: "in_progress",
      expiresAt: expiredAt,
      answers: [],
      scores: {},
      save: vi.fn(),
    };
    vi.spyOn(AttemptModel, "findById").mockResolvedValue(mockAttempt as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
          toObject: () => ({
            _id: examId,
            sections: [],
          }),
        }),
      }),
    } as never);
    vi.spyOn(AttemptModel, "findOneAndUpdate").mockResolvedValueOnce({
      _id: attemptId,
      status: "expired",
      submittedAt: expiredAt,
      scores: {},
    } as never);

    const result = await getAttemptForRecovery(attemptId, studentId);
    expect(result.status).toBe("expired");
    expect(result.remainingSeconds).toBe(0);
  });
});

describe("BUG-03 assignment requirement flag", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const examId = new mongoose.Types.ObjectId().toString();

  it("throws ASSIGNMENT_REQUIRED when the env flag is enabled and no assignmentId is given", async () => {
    const original = env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT;
    env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT = true;

    try {
      vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
        _id: examId,
        status: "published",
      } as never);

      await expect(startAttempt(studentId, examId)).rejects.toThrow(BadRequestError);
    } finally {
      env.REQUIRE_ASSIGNMENT_FOR_ATTEMPT = original;
    }
  });

  it("allows starting without assignmentId when the flag is disabled (default)", async () => {
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
      _id: examId,
      status: "published",
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
          toObject: () => ({ _id: examId, title: "T", sections: [] }),
        }),
      }),
    } as never);
    vi.spyOn(AttemptModel, "findOne").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(examId),
      examId: new mongoose.Types.ObjectId(examId),
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      status: "in_progress",
    } as never);

    const result = await startAttempt(studentId, examId);
    expect(result.attemptId).toBeDefined();
  });
});

describe("BUG-05 expired attempt result", () => {
  const attemptId = new mongoose.Types.ObjectId();
  const studentOwnerId = new mongoose.Types.ObjectId();

  it("returns the result of an expired (auto-submitted) attempt", async () => {
    const examId = new mongoose.Types.ObjectId();
    const mockAttempt = {
      _id: attemptId,
      studentId: studentOwnerId,
      status: "expired",
      examId: { _id: examId, createdBy: new mongoose.Types.ObjectId() },
      assignmentId: null,
      answers: [],
      scores: { overallBand: 6 },
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAttempt),
      }),
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
          toObject: () => ({ _id: examId, title: "T", sections: [] }),
        }),
      }),
    } as never);
    vi.spyOn(WritingReviewModel, "findOne").mockResolvedValueOnce(null);

    const result = await getAttemptResult(attemptId.toString(), {
      id: studentOwnerId.toString(),
      role: "student",
    });

    expect(result.status).toBe("expired");
    expect(result.scores.overallBand).toBe(6);
  });

  it("masks scores for students when showScoreAfterSubmit is false", async () => {
    const examId = new mongoose.Types.ObjectId();
    const mockAttempt = {
      _id: attemptId,
      studentId: studentOwnerId,
      status: "submitted",
      examId: { _id: examId, createdBy: new mongoose.Types.ObjectId() },
      assignmentId: { _id: new mongoose.Types.ObjectId(), showScoreAfterSubmit: false },
      answers: [],
      scores: { overallBand: 7 },
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue(mockAttempt),
      }),
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockReturnValue({
        populate: vi.fn().mockResolvedValue({
          toObject: () => ({ _id: examId, title: "T", sections: [] }),
        }),
      }),
    } as never);
    vi.spyOn(WritingReviewModel, "findOne").mockResolvedValue(null);

    const studentResult = await getAttemptResult(attemptId.toString(), {
      id: studentOwnerId.toString(),
      role: "student",
    });
    expect(studentResult.scores.overallBand).toBeUndefined();

    const adminResult = await getAttemptResult(attemptId.toString(), {
      id: new mongoose.Types.ObjectId().toString(),
      role: "admin",
    });
    expect(adminResult.scores.overallBand).toBe(7);
  });
});

describe("question shuffle helpers", () => {
  it("is deterministic for the same seed and preserves all ids", () => {
    const ids = ["a", "b", "c", "d", "e"];

    const first = shuffleQuestionIds(ids, 42);
    const second = shuffleQuestionIds(ids, 42);

    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([...ids].sort());
  });

  it("reorders candidate exam questions according to a stored order", () => {
    const exam: CandidateExam = {
      id: "exam-1",
      title: "Mock",
      sections: [
        {
          skill: "reading",
          part: 1,
          title: "S1",
          instructions: null,
          passageText: null,
          mediaIds: [],
          media: [],
          questions: [
            { id: "q1", prompt: "1", type: "t", part: 1, points: 1, content: null, data: {}, mediaIds: [], media: [] },
            { id: "q2", prompt: "2", type: "t", part: 1, points: 1, content: null, data: {}, mediaIds: [], media: [] },
            { id: "q3", prompt: "3", type: "t", part: 1, points: 1, content: null, data: {}, mediaIds: [], media: [] },
          ],
        },
      ],
    };

    expect(collectCandidateQuestionIds(exam)).toEqual(["q1", "q2", "q3"]);

    const reordered = applyQuestionOrder(exam, ["q3", "q1", "q2"]);
    expect(reordered.sections[0].questions.map((question) => question.id)).toEqual([
      "q3",
      "q1",
      "q2",
    ]);
    expect(applyQuestionOrder(exam, [])).toBe(exam);
  });
});
