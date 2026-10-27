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
  collectExamMediaIds,
  collectExamQuestionBuckets,
  computeRemainingSeconds,
  examMediaPresignTtl,
  finalizeAttempt,
  getAttemptForRecovery,
  getAttemptResult,
  gradeGroupedQuestions,
  gradeGroupedQuestionsDetailed,
  shuffleQuestionIds,
  startAttempt,
  stripGroupConfig,
  submitAttempt,
  type CandidateExam,
  type RawExamObject,
} from "./attempt.service.js";

/** Build a question item as stored inside an exam question group. */
function makeGroupQuestion(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    questionNumber: 1,
    prompt: "Write the answer.",
    acceptedAnswers: ["secret-answer"],
    points: 1,
    explanation: "secret-explanation",
    mediaIds: [] as unknown[],
    ...overrides,
  };
}

/** Build a single question group wrapping one (or more) group questions. */
function makeGroup(overrides: Record<string, unknown> = {}) {
  const { questions, ...rest } = overrides;
  return {
    _id: new mongoose.Types.ObjectId(),
    groupType: "form_completion",
    instructions: "",
    config: {},
    questions: (questions as unknown[] | undefined) ?? [makeGroupQuestion()],
    ...rest,
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
          questionGroups: [makeGroup({ questions: [makeGroupQuestion({ points: 2 })] })],
        },
      ],
    }),
  } as unknown as IExam;

  it("defaults disableTextSelection to false", () => {
    const candidate = buildCandidateExam(examStub);
    expect(candidate.disableTextSelection).toBe(false);
  });

  it("exposes disableTextSelection to candidates", () => {
    const examWithBlock = {
      ...examStub,
      disableTextSelection: true,
    } as unknown as IExam;

    const candidate = buildCandidateExam(examWithBlock);
    expect(candidate.disableTextSelection).toBe(true);
  });

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
    const question = candidate.sections[0].questionGroups[0].questions[0];

    expect(candidate.title).toBe("IELTS Mock 01");
    expect(candidate.sections[0].skill).toBe("listening");
    expect(question.prompt).toBe("Write the answer.");
    expect(question.points).toBe(2);
  });

  it("heals legacy duplicate/out-of-order numbers and template blanks", () => {
    const legacyExam = {
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        title: "Legacy numbering",
        sections: [
          {
            skill: "listening",
            part: 1,
            title: "Part 1",
            questionGroups: [
              makeGroup({
                questions: [
                  makeGroupQuestion({ questionNumber: 6 }),
                  makeGroupQuestion({ questionNumber: 7 }),
                ],
              }),
              makeGroup({
                config: { template: "Name: [1]\nCity: [2]" },
                questions: [
                  makeGroupQuestion({ questionNumber: 2 }),
                  makeGroupQuestion({ questionNumber: 3 }),
                ],
              }),
            ],
          },
        ],
      }),
    } as unknown as IExam;

    const candidate = buildCandidateExam(legacyExam);
    const groups = candidate.sections[0].questionGroups;

    expect(
      groups.flatMap((group) => group.questions.map((q) => q.questionNumber))
    ).toEqual([1, 2, 3, 4]);
    expect(groups[1].config.template).toBe("Name: [3]\nCity: [4]");
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
            questionGroups: [
              makeGroup({ questions: [makeGroupQuestion({ mediaIds: [questionMediaDoc] })] }),
            ],
          },
        ],
      }),
    } as unknown as IExam;

    const candidate = buildCandidateExam(examWithMedia);
    expect(candidate.sections[0].media).toHaveLength(1);
    expect(candidate.sections[0].media[0].url).toContain("audio/test.mp3");
    expect(candidate.sections[0].media[0].type).toBe("audio");
    expect(candidate.sections[0].questionGroups[0].questions[0].media).toHaveLength(1);
    expect(candidate.sections[0].questionGroups[0].questions[0].media[0].url).toContain(
      "images/diagram.png"
    );
    expect(candidate.sections[0].questionGroups[0].questions[0].media[0].type).toBe("image");
  });

  it("resolves a group-level image (config.imageMediaId) from the media url map", () => {
    const groupImageId = new mongoose.Types.ObjectId().toString();
    const examWithGroupImage = {
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        title: "Group image exam",
        sections: [
          {
            skill: "reading",
            part: 1,
            title: "Passage 1",
            instructions: "Look at the diagram",
            mediaIds: [],
            questionGroups: [
              makeGroup({
                groupType: "diagram_labelling",
                config: { imageMediaId: groupImageId },
              }),
            ],
          },
        ],
      }),
    } as unknown as IExam;

    const urlMap = new Map([[groupImageId, "https://media.local/diagram.png"]]);
    const candidate = buildCandidateExam(examWithGroupImage, urlMap);
    const group = candidate.sections[0].questionGroups[0];

    expect(group.media).toHaveLength(1);
    expect(group.media[0]).toMatchObject({
      id: groupImageId,
      url: "https://media.local/diagram.png",
      type: "image",
    });
    // Raw id stays in config for the editor round-trip.
    expect(group.config.imageMediaId).toBe(groupImageId);
  });

  it("skips group-level images that cannot be resolved", () => {
    const examWithGroupImage = {
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        title: "Group image exam",
        sections: [
          {
            skill: "reading",
            part: 1,
            title: "Passage 1",
            mediaIds: [],
            questionGroups: [makeGroup({ config: { imageMediaId: "not-an-object-id" } })],
          },
        ],
      }),
    } as unknown as IExam;

    const candidate = buildCandidateExam(examWithGroupImage);
    expect(candidate.sections[0].questionGroups[0].media).toEqual([]);
  });
});

describe("collectExamMediaIds", () => {
  function examWithGroupConfig(config: Record<string, unknown>): IExam {
    return {
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        title: "Collect",
        sections: [
          {
            skill: "listening",
            part: 2,
            title: "Part 2",
            mediaIds: [],
            questionGroups: [makeGroup({ config })],
          },
        ],
      }),
    } as unknown as IExam;
  }

  it("includes group-level config.imageMediaId references", () => {
    const groupImageId = new mongoose.Types.ObjectId().toString();

    expect(collectExamMediaIds(examWithGroupConfig({ imageMediaId: groupImageId }))).toContain(
      groupImageId
    );
  });

  it("ignores malformed config.imageMediaId values", () => {
    expect(collectExamMediaIds(examWithGroupConfig({ imageMediaId: "abc" }))).toEqual([]);
    expect(collectExamMediaIds(examWithGroupConfig({ imageMediaId: 42 }))).toEqual([]);
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
          questionGroups: [makeGroup({ groupType: "writing_task_1" })],
        },
      ],
    };

    const buckets = collectExamQuestionBuckets(examObj);

    expect(buckets.hasWriting).toBe(true);
    expect(buckets.hasListening).toBe(false);
    expect(buckets.hasReading).toBe(false);
    expect(buckets.listeningGrouped).toHaveLength(0);
    expect(buckets.readingGrouped).toHaveLength(0);
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
          questionGroups: [makeGroup()],
        },
        {
          skill: "reading",
          part: 1,
          title: "R1",
          questionGroups: [makeGroup()],
        },
      ],
    };

    const buckets = collectExamQuestionBuckets(examObj);

    expect(buckets.hasListening).toBe(true);
    expect(buckets.hasReading).toBe(true);
    expect(buckets.hasWriting).toBe(false);
    expect(buckets.listeningGrouped).toHaveLength(1);
    expect(buckets.readingGrouped).toHaveLength(1);
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
      populate: vi.fn().mockResolvedValue(null),
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
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: strangerStudentId.toString(), role: "student" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows student to access their own attempt when studentId is populated as an object", async () => {
    const mockAttempt = {
      _id: attemptId,
      studentId: { _id: studentOwnerId, fullName: "Nguyen Giang", email: "giang@example.com" },
      status: "in_progress", // will throw EXAM_NOT_SUBMITTED, proving it passed ATTEMPT_NOT_OWNED check
      examId: { _id: new mongoose.Types.ObjectId(), title: "Test Exam" },
      assignmentId: null,
    };
    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);

    await expect(
      getAttemptResult(attemptId.toString(), { id: studentOwnerId.toString(), role: "student" })
    ).rejects.toThrow("Bài thi chưa được nộp.");
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
      populate: vi.fn().mockResolvedValue(mockAttempt),
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
      populate: vi.fn().mockResolvedValue(mockAttempt),
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
      populate: vi.fn().mockResolvedValue(mockAttempt),
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
      populate: vi.fn().mockResolvedValue({
          toObject: () => ({
            _id: examId,
            sections: [],
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
      populate: vi.fn().mockResolvedValue({
          toObject: () => ({
            _id: examId,
            sections: [],
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
      populate: vi.fn().mockResolvedValue({
          toObject: () => ({ _id: examId, title: "T", sections: [] }),
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
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue({
          toObject: () => ({ _id: examId, title: "T", sections: [] }),
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
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      populate: vi.fn().mockResolvedValue({
          toObject: () => ({ _id: examId, title: "T", sections: [] }),
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

describe("startAttempt assignment preference (FIX-12)", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const examId = new mongoose.Types.ObjectId().toString();
  const assignmentId = new mongoose.Types.ObjectId().toString();

  function mockExamLookups() {
    vi.spyOn(ExamModel, "findById")
      .mockResolvedValueOnce({
        _id: examId,
        status: "published",
        durationMinutes: 60,
      } as never)
      .mockReturnValueOnce({
        populate: vi.fn().mockResolvedValue({
            toObject: () => ({ _id: examId, title: "T", durationMinutes: 60, sections: [] }),
          }),
      } as never);
  }

  function mockAssignment() {
    vi.spyOn(AssignmentModel, "findById").mockResolvedValueOnce({
      _id: assignmentId,
      status: "active",
      examId,
      maxAttempts: 2,
    } as never);
    vi.spyOn(AttemptModel, "countDocuments").mockResolvedValueOnce(0 as never);
  }

  it("returns the attempt already bound to the assignment", async () => {
    mockExamLookups();
    mockAssignment();

    const boundAttempt = {
      _id: new mongoose.Types.ObjectId(),
      examId,
      assignmentId,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      status: "in_progress",
      questionOrder: [],
    };
    const findOneSpy = vi
      .spyOn(AttemptModel, "findOne")
      .mockResolvedValueOnce(boundAttempt as never);

    const result = await startAttempt(studentId, examId, assignmentId);

    expect(result.attemptId).toBe(boundAttempt._id.toString());
    expect(findOneSpy.mock.calls[0][0]).toMatchObject({
      studentId,
      assignmentId,
      status: "in_progress",
    });
  });

  it("attaches the assignment to an existing free attempt", async () => {
    mockExamLookups();
    mockAssignment();

    const freeAttempt = {
      _id: new mongoose.Types.ObjectId(),
      examId,
      assignmentId: undefined as unknown as mongoose.Types.ObjectId,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      status: "in_progress",
      questionOrder: [],
      save: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(AttemptModel, "findOne")
      .mockResolvedValueOnce(null) // no attempt bound to the assignment
      .mockResolvedValueOnce(freeAttempt as never); // free attempt found by examId

    const result = await startAttempt(studentId, examId, assignmentId);

    expect(result.attemptId).toBe(freeAttempt._id.toString());
    expect(freeAttempt.assignmentId?.toString()).toBe(assignmentId);
    expect(freeAttempt.save).toHaveBeenCalled();
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
          questionGroups: [
            {
              id: "g1",
              groupType: "summary_completion",
              instructions: "",
              config: {},
              questions: [
                { id: "q1", questionNumber: 1, prompt: "1", points: 1, mediaIds: [], media: [] },
                { id: "q2", questionNumber: 2, prompt: "2", points: 1, mediaIds: [], media: [] },
                { id: "q3", questionNumber: 3, prompt: "3", points: 1, mediaIds: [], media: [] },
              ],
            },
          ],
        },
      ],
    };

    expect(collectCandidateQuestionIds(exam)).toEqual(["q1", "q2", "q3"]);

    const reordered = applyQuestionOrder(exam, ["q3", "q1", "q2"]);
    expect(
      reordered.sections[0].questionGroups[0].questions.map((question) => question.id)
    ).toEqual(["q3", "q1", "q2"]);
    expect(applyQuestionOrder(exam, [])).toBe(exam);
  });

  it("reorders questions inside question groups but keeps group order stable (FIX-09)", () => {
    const exam: CandidateExam = {
      id: "exam-groups",
      title: "Grouped",
      sections: [
        {
          id: "s1",
          skill: "reading",
          part: 1,
          title: "P1",
          instructions: null,
          passageText: null,
          transcript: null,
          mediaIds: [],
          media: [],
          questions: [],
          questionGroups: [
            {
              id: "g1",
              groupType: "summary_completion",
              instructions: "",
              config: {},
              questions: [
                { id: "a", questionNumber: 1, prompt: "", points: 1, mediaIds: [], media: [] },
                { id: "b", questionNumber: 2, prompt: "", points: 1, mediaIds: [], media: [] },
                { id: "c", questionNumber: 3, prompt: "", points: 1, mediaIds: [], media: [] },
              ],
            },
            {
              id: "g2",
              groupType: "summary_completion",
              instructions: "",
              config: {},
              questions: [
                { id: "d", questionNumber: 4, prompt: "", points: 1, mediaIds: [], media: [] },
              ],
            },
          ],
        },
      ],
    };

    const reordered = applyQuestionOrder(exam, ["c", "b", "a", "d"]);
    const groups = reordered.sections[0].questionGroups;

    // Group order must NOT change (templates bind to questionNumber).
    expect(groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    // Within the group, questions follow the shuffled order, numbering intact.
    expect(groups[0].questions.map((q) => q.id)).toEqual(["c", "b", "a"]);
    expect(groups[0].questions.map((q) => q.questionNumber)).toEqual([3, 2, 1]);
  });
});

describe("buildCandidateExam question-group safety (FIX-18)", () => {
  it("whitelists config and never leaks acceptedAnswers/explanation", () => {
    const examStub = {
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        title: "Grouped",
        sections: [
          {
            skill: "reading",
            part: 1,
            title: "P1",
            instructions: "Do this",
            passageText: null,
            mediaIds: [],
            questionGroups: [
              {
                _id: new mongoose.Types.ObjectId(),
                groupType: "summary_completion",
                instructions: "",
                config: {
                  options: [{ id: "A", text: "alpha" }],
                  foo: "unknown-key",
                  acceptedAnswers: ["config-leak"],
                },
                questions: [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    questionNumber: 1,
                    prompt: "Q1",
                    acceptedAnswers: ["secret-answer"],
                    points: 1,
                    explanation: "secret-explanation",
                    mediaIds: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    } as unknown as IExam;

    const candidate = buildCandidateExam(examStub);
    const serialized = JSON.stringify(candidate);

    expect(serialized).not.toContain("secret-answer");
    expect(serialized).not.toContain("secret-explanation");
    expect(serialized).not.toContain("config-leak");
    expect(serialized).not.toContain("unknown-key");

    const config = candidate.sections[0].questionGroups[0].config;
    expect(config.options).toBeDefined();
    expect(config.foo).toBeUndefined();
    expect(config.acceptedAnswers).toBeUndefined();
  });
});

describe("stripGroupConfig whitelist (FIX-18)", () => {
  it("keeps only whitelisted display keys", () => {
    const result = stripGroupConfig({
      options: [{ id: "A", text: "a" }],
      maxWords: 3,
      foo: "bar",
    });

    expect(result.options).toBeDefined();
    expect(result.maxWords).toBe(3);
    expect(result.foo).toBeUndefined();
  });

  it("keeps allowChangeAnswer so the candidate UI can lock answers", () => {
    const result = stripGroupConfig({ allowChangeAnswer: false, secret: "x" });

    expect(result.allowChangeAnswer).toBe(false);
    expect(result.secret).toBeUndefined();
  });
});

describe("examMediaPresignTtl", () => {
  it("covers the attempt plus six hours of slack", () => {
    expect(examMediaPresignTtl(60)).toBe(60 * 60 + 6 * 3600);
  });

  it("stays valid for short practice attempts", () => {
    expect(examMediaPresignTtl(10)).toBe(10 * 60 + 6 * 3600);
  });
});

describe("gradeGroupedQuestions word limit (FIX-11)", () => {
  const qId = new mongoose.Types.ObjectId();
  const answers = [{ questionId: qId, value: "one two three" }];

  it("ignores maxWords for non-completion group types", () => {
    const score = gradeGroupedQuestions(answers, [
      {
        _id: qId,
        questionNumber: 1,
        acceptedAnswers: ["one two three"],
        points: 1,
        groupConfig: { maxWords: 2 },
        groupType: "multiple_choice_single",
      },
    ]);

    expect(score).toBe(1);
  });

  it("enforces maxWords for completion group types", () => {
    const score = gradeGroupedQuestions(answers, [
      {
        _id: qId,
        questionNumber: 1,
        acceptedAnswers: ["one two three"],
        points: 1,
        groupConfig: { maxWords: 2 },
        groupType: "summary_completion",
      },
    ]);

    expect(score).toBe(0);
  });
});

describe("gradeGroupedQuestions counts", () => {
  it("returns correct, wrong and blank counts", () => {
    const q1 = new mongoose.Types.ObjectId();
    const q2 = new mongoose.Types.ObjectId();
    const q3 = new mongoose.Types.ObjectId();

    const result = gradeGroupedQuestionsDetailed(
      [
        { questionId: q1, value: "right" },
        { questionId: q2, value: "wrong" },
      ],
      [
        {
          _id: q1,
          questionNumber: 1,
          acceptedAnswers: ["right"],
          points: 1,
          groupConfig: {},
          groupType: "short_answer",
        },
        {
          _id: q2,
          questionNumber: 2,
          acceptedAnswers: ["correct"],
          points: 1,
          groupConfig: {},
          groupType: "short_answer",
        },
        {
          _id: q3,
          questionNumber: 3,
          acceptedAnswers: ["answer"],
          points: 1,
          groupConfig: {},
          groupType: "short_answer",
        },
      ]
    );

    expect(result).toEqual({
      rawScore: 1,
      correctCount: 1,
      wrongCount: 1,
      blankCount: 1,
    });
  });
});

describe("Practice start, scoring, and resources", () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const examId = new mongoose.Types.ObjectId().toString();

  it("allows starting practice exam without assignmentId", async () => {
    vi.spyOn(ExamModel, "findById").mockResolvedValueOnce({
      _id: examId,
      kind: "practice",
      status: "published",
      durationMinutes: 20,
    } as never).mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue({
        _id: examId,
        kind: "practice",
        durationMinutes: 20,
        sections: [
          {
            skill: "reading",
            part: 1,
            questionGroups: [],
          },
        ],
        toObject: () => ({ _id: examId, title: "Practice", sections: [] }),
      }),
    } as never);

    vi.spyOn(AttemptModel, "findOne").mockResolvedValueOnce(null);

    let createdAttemptData: unknown;
    vi.spyOn(AttemptModel, "create").mockImplementationOnce((data: unknown) => {
      createdAttemptData = data;
      return {
        _id: new mongoose.Types.ObjectId(),
        examId,
        studentId,
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        status: "in_progress",
        examKind: "practice",
        skills: ["reading"],
        questionCount: 0,
      } as never;
    });

    const result = await startAttempt(studentId, examId);
    expect(result.status).toBe("in_progress");
    expect(createdAttemptData).toMatchObject({
      examKind: "practice",
      skills: ["reading"],
    });
  });

  it("finalizes practice in raw mode without computing band score", async () => {
    const qId = new mongoose.Types.ObjectId();
    const attempt = {
      _id: new mongoose.Types.ObjectId(),
      studentId: new mongoose.Types.ObjectId(studentId),
      examId: new mongoose.Types.ObjectId(examId),
      status: "in_progress",
      answers: [{ questionId: qId, value: "answer1" }],
      scores: {},
    };

    vi.spyOn(ExamModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue({
        _id: examId,
        kind: "practice",
        scoringMode: "raw",
        toObject: () => ({
          _id: examId,
          title: "Practice",
          sections: [
            {
              skill: "reading",
              questionGroups: [
                {
                  groupType: "short_answer",
                  questions: [
                    {
                      _id: qId,
                      questionNumber: 1,
                      acceptedAnswers: ["answer1"],
                      points: 1,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    } as never);

    let savedScores: unknown;
    vi.spyOn(AttemptModel, "findOneAndUpdate").mockImplementationOnce((_filter: unknown, update: unknown) => {
      savedScores = (update as { $set: { scores: unknown } }).$set.scores;
      return {
        _id: attempt._id,
        status: "submitted",
        scores: savedScores,
      } as never;
    });

    const result = await finalizeAttempt(attempt as never, new Date());
    expect(result.status).toBe("submitted");
    expect(savedScores).toMatchObject({
      readingRaw: 1,
    });
    // Band score must NOT be calculated for practice in raw mode
    expect((savedScores as { readingBand?: number }).readingBand).toBeUndefined();
    expect((savedScores as { overallBand?: number }).overallBand).toBeUndefined();
  });

  it("forces raw scoring for practice even with legacy scoringMode=band", async () => {
    const qId = new mongoose.Types.ObjectId();
    const attempt = {
      _id: new mongoose.Types.ObjectId(),
      studentId: new mongoose.Types.ObjectId(studentId),
      examId: new mongoose.Types.ObjectId(examId),
      status: "in_progress",
      answers: [{ questionId: qId, value: "answer1" }],
      scores: {},
    };

    vi.spyOn(ExamModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue({
        _id: examId,
        kind: "practice",
        scoringMode: "band",
        toObject: () => ({
          _id: examId,
          title: "Practice 40",
          sections: [
            {
              skill: "reading",
              questionGroups: [
                {
                  groupType: "short_answer",
                  questions: [
                    {
                      _id: qId,
                      questionNumber: 1,
                      acceptedAnswers: ["answer1"],
                      points: 1,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    } as never);

    let savedScores: unknown;
    vi.spyOn(AttemptModel, "findOneAndUpdate").mockImplementationOnce((_filter: unknown, update: unknown) => {
      savedScores = (update as { $set: { scores: unknown } }).$set.scores;
      return {
        _id: attempt._id,
        status: "submitted",
        scores: savedScores,
      } as never;
    });

    const result = await finalizeAttempt(attempt as never, new Date());
    expect(result.status).toBe("submitted");
    expect(savedScores).toMatchObject({
      readingRaw: 1,
    });
    // Practice must never calculate bands, even if legacy data says band.
    expect((savedScores as { readingBand?: number }).readingBand).toBeUndefined();
    expect((savedScores as { overallBand?: number }).overallBand).toBeUndefined();
  });

  it("hides rawScore, percentage, and resources when showScoreAfterSubmit is false", async () => {
    const qId = new mongoose.Types.ObjectId();
    const attemptId = new mongoose.Types.ObjectId().toString();

    const mockAttempt = {
      _id: attemptId,
      studentId: studentId,
      examId: { _id: examId, title: "Mock Exam", durationMinutes: 60 },
      assignmentId: { teacherId: "teacher-1", showScoreAfterSubmit: false },
      status: "submitted",
      answers: [{ questionId: qId, value: "my-answer" }],
      scores: { listeningRaw: 10, listeningBand: 5.0 },
      questionCount: 40,
    };

    vi.spyOn(AttemptModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue(mockAttempt),
    } as never);

    vi.spyOn(WritingReviewModel, "findOne").mockResolvedValueOnce(null);

    vi.spyOn(ExamModel, "findById").mockReturnValueOnce({
      populate: vi.fn().mockResolvedValue({
        _id: examId,
        kind: "practice",
        scoringMode: "raw",
        postSubmissionResources: {
          solutionNotes: "Hidden note",
        },
        toObject: () => ({
          _id: examId,
          sections: [
            {
              skill: "listening",
              questionGroups: [
                {
                  groupType: "short_answer",
                  questions: [
                    {
                      _id: qId,
                      questionNumber: 1,
                      acceptedAnswers: ["correct-answer"],
                      points: 1,
                      explanation: "Hidden explanation",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }),
    } as never);

    const result = await getAttemptResult(attemptId, { id: studentId, role: "student" });
    // Resources must be hidden
    expect(result.postSubmissionResources).toBeNull();
    // Scores and rawScore/percentage must be hidden
    expect(result.rawScore).toBeUndefined();
    expect(result.percentage).toBeUndefined();
    expect(result.scores).toEqual({});
    // Answer keys must be masked
    expect(result.details[0].acceptedAnswers).toEqual([]);
    expect(result.details[0].isCorrect).toBe(false);
    expect(result.details[0].explanation).toBeNull();
  });
});
