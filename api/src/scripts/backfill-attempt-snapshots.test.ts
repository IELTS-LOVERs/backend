import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { AttemptModel } from "../modules/attempts/attempt.model.js";
import { ExamModel } from "../modules/exams/exam.model.js";
import { runBackfillSnapshots } from "./backfill-attempt-snapshots.js";

function makeCursor(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

describe("backfill-attempt-snapshots", () => {
  it("skips attempts that already have a snapshot and freezes legacy ones", async () => {
    const examId = new mongoose.Types.ObjectId();
    const questionId = new mongoose.Types.ObjectId();

    const withSnapshot = {
      _id: new mongoose.Types.ObjectId(),
      examId,
      status: "submitted",
      answers: [{ questionId, value: "london" }],
      resultDetails: [{ questionId, studentAnswer: "london", isCorrect: true }],
    };
    const legacy = {
      _id: new mongoose.Types.ObjectId(),
      examId,
      status: "submitted",
      answers: [{ questionId, value: "london" }],
      resultDetails: undefined,
    };

    vi.spyOn(AttemptModel, "find").mockReturnValue({
      lean: () => ({ cursor: () => makeCursor([withSnapshot, legacy]) }),
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: examId,
        sections: [
          {
            skill: "listening",
            questionGroups: [
              {
                groupType: "short_answer",
                config: {},
                questions: [
                  {
                    _id: questionId,
                    questionNumber: 1,
                    prompt: "City?",
                    acceptedAnswers: ["london"],
                    points: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    } as never);
    const update = vi
      .spyOn(AttemptModel, "updateOne")
      .mockResolvedValue({} as never);

    const result = await runBackfillSnapshots(false);

    expect(result.attemptsChecked).toBe(2);
    expect(result.attemptsSkipped).toBe(1);
    expect(result.attemptsUpdated).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);

    const [filter, updateDoc] = update.mock.calls[0] as [
      { _id: mongoose.Types.ObjectId },
      { $set: { resultDetails: unknown[]; questionCount: number; totalPoints: number } },
    ];
    expect(filter._id.toString()).toBe(legacy._id.toString());
    expect(updateDoc.$set.resultDetails).toHaveLength(1);
    expect(updateDoc.$set.questionCount).toBe(1);
    expect(updateDoc.$set.totalPoints).toBe(1);
  });

  it("does not write in dry-run mode", async () => {
    const examId = new mongoose.Types.ObjectId();
    const questionId = new mongoose.Types.ObjectId();

    vi.spyOn(AttemptModel, "find").mockReturnValue({
      lean: () => ({
        cursor: () =>
          makeCursor([
            {
              _id: new mongoose.Types.ObjectId(),
              examId,
              status: "submitted",
              answers: [],
            },
          ]),
      }),
    } as never);
    vi.spyOn(ExamModel, "findById").mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: examId,
        sections: [
          {
            skill: "listening",
            questionGroups: [
              {
                groupType: "short_answer",
                config: {},
                questions: [
                  {
                    _id: questionId,
                    questionNumber: 1,
                    prompt: "City?",
                    acceptedAnswers: ["london"],
                    points: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    } as never);
    const update = vi.spyOn(AttemptModel, "updateOne");

    const result = await runBackfillSnapshots(true);

    expect(result.attemptsUpdated).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });
});
