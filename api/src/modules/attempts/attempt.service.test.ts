import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import type { IExam } from "../exams/exam.model.js";
import type { IAttemptAnswer } from "./attempt.model.js";
import {
  buildCandidateExam,
  canAccessAttemptResult,
  collectExamQuestionBuckets,
  computeRemainingSeconds,
  gradeQuestions,
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
