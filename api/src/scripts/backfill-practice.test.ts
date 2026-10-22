import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { AttemptModel } from "../modules/attempts/attempt.model.js";
import { ExamModel } from "../modules/exams/exam.model.js";
import { runBackfill } from "./backfill-practice.js";

const leanResult = <T>(docs: T[]) => ({ lean: vi.fn().mockResolvedValue(docs) });
const cursorResult = <T>(docs: T[]) => ({
  lean: vi.fn().mockReturnValue({
    cursor: () => (async function* () {
      for (const doc of docs) yield doc;
    })(),
  }),
});

describe("backfill-practice migration script", () => {
  it("backfills missing kind, scoringMode and attempt snapshots from raw (lean) docs", async () => {
    const examId = new mongoose.Types.ObjectId();
    const attemptId = new mongoose.Types.ObjectId();

    const sections = [
      {
        skill: "reading",
        questionGroups: [
          {
            questions: [
              { questionNumber: 1, points: 1 },
              { questionNumber: 2, points: 1 },
            ],
          },
        ],
      },
    ];

    // Simulates a raw Mongo document: no Mongoose defaults applied.
    const legacyExam = {
      _id: examId,
      sections,
    };

    const legacyAttempt = {
      _id: attemptId,
      examId,
    };

    vi.spyOn(ExamModel, "find").mockReturnValueOnce(leanResult([legacyExam]) as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce(cursorResult([legacyAttempt]) as never);

    let examUpdatedPayload: unknown;
    vi.spyOn(ExamModel, "updateOne").mockImplementationOnce((_filter: unknown, update: unknown) => {
      examUpdatedPayload = update;
      return Promise.resolve({ modifiedCount: 1 } as never);
    });

    let attemptUpdatedPayload: unknown;
    vi.spyOn(AttemptModel, "updateOne").mockImplementationOnce((_filter: unknown, update: unknown) => {
      attemptUpdatedPayload = update;
      return Promise.resolve({ modifiedCount: 1 } as never);
    });

    const result = await runBackfill(false);

    expect(result.examsUpdated).toBe(1);
    expect(result.attemptsUpdated).toBe(1);
    expect(examUpdatedPayload).toMatchObject({
      $set: {
        kind: "mock",
        scoringMode: "band",
      },
    });
    expect(attemptUpdatedPayload).toMatchObject({
      $set: {
        examKind: "mock",
        scoringMode: "band",
        skills: ["reading"],
        questionCount: 2,
        totalPoints: 2,
      },
    });
  });

  it("does not update documents when dryRun is true", async () => {
    const examId = new mongoose.Types.ObjectId();
    const legacyExam = {
      _id: examId,
      sections: [],
    };

    vi.spyOn(ExamModel, "find").mockReturnValueOnce(leanResult([legacyExam]) as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce(cursorResult([]) as never);

    const examUpdateSpy = vi.spyOn(ExamModel, "updateOne");
    const attemptUpdateSpy = vi.spyOn(AttemptModel, "updateOne");

    const result = await runBackfill(true);

    expect(result.examsUpdated).toBe(1);
    expect(examUpdateSpy).not.toHaveBeenCalled();
    expect(attemptUpdateSpy).not.toHaveBeenCalled();
  });

  it("is idempotent: skips documents that already have the required fields", async () => {
    const examId = new mongoose.Types.ObjectId();
    const completeExam = {
      _id: examId,
      kind: "practice",
      scoringMode: "raw",
      sections: [],
    };

    const completeAttempt = {
      _id: new mongoose.Types.ObjectId(),
      examId,
      examKind: "practice",
      scoringMode: "raw",
      skills: ["listening"],
      questionCount: 10,
      totalPoints: 10,
    };

    vi.spyOn(ExamModel, "find").mockReturnValueOnce(leanResult([completeExam]) as never);
    vi.spyOn(AttemptModel, "find").mockReturnValueOnce(cursorResult([completeAttempt]) as never);

    const examUpdateSpy = vi.spyOn(ExamModel, "updateOne");
    const attemptUpdateSpy = vi.spyOn(AttemptModel, "updateOne");

    const result = await runBackfill(false);

    expect(result.examsUpdated).toBe(0);
    expect(result.examsSkipped).toBe(1);
    expect(result.attemptsUpdated).toBe(0);
    expect(result.attemptsSkipped).toBe(1);
    expect(examUpdateSpy).not.toHaveBeenCalled();
    expect(attemptUpdateSpy).not.toHaveBeenCalled();
  });
});
