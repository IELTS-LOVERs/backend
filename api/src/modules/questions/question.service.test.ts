import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import { QuestionModel, type IQuestion } from "./question.model.js";
import { assertOwner, list, serializeQuestion } from "./question.service.js";

describe("serializeQuestion", () => {
  it("converts ObjectIds to strings and normalizes null fields", () => {
    const questionId = new mongoose.Types.ObjectId();
    const mediaId = new mongoose.Types.ObjectId();
    const creatorId = new mongoose.Types.ObjectId();
    const now = new Date();

    const mockQuestion = {
      _id: questionId,
      skill: "listening",
      type: "multiple_choice",
      part: 1,
      prompt: "Choose the correct answer",
      content: undefined,
      data: { options: ["A", "B", "C"] },
      acceptedAnswers: ["A"],
      points: 1,
      explanation: undefined,
      mediaIds: [mediaId],
      createdBy: creatorId,
      createdAt: now,
      updatedAt: now,
    } as unknown as IQuestion;

    const serialized = serializeQuestion(mockQuestion);

    expect(serialized.id).toBe(questionId.toString());
    expect(serialized.skill).toBe("listening");
    expect(serialized.type).toBe("multiple_choice");
    expect(serialized.part).toBe(1);
    expect(serialized.content).toBeNull();
    expect(serialized.explanation).toBeNull();
    expect(serialized.mediaIds).toEqual([mediaId.toString()]);
    expect(serialized.createdBy).toBe(creatorId.toString());
    expect(serialized.points).toBe(1);
  });
});

describe("assertOwner", () => {
  const creatorId = new mongoose.Types.ObjectId();

  it("permits admin role to access any question", () => {
    const question = { createdBy: creatorId };
    expect(() => assertOwner(question, "different-user-id", "admin")).not.toThrow();
  });

  it("permits owner teacher to access their own question", () => {
    const question = { createdBy: creatorId };
    expect(() => assertOwner(question, creatorId.toString(), "teacher")).not.toThrow();
  });

  it("throws ForbiddenError for non-owner teacher", () => {
    const question = { createdBy: creatorId };
    expect(() => assertOwner(question, "other-teacher-id", "teacher")).toThrow(ForbiddenError);
  });
});

describe("list questions with search", () => {
  it("builds $or regex query when search filter is supplied", async () => {
    let capturedQuery: unknown;
    const mockFind = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(QuestionModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query;
      return mockFind as never;
    });
    vi.spyOn(QuestionModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await list({
      page: 1,
      limit: 20,
      search: "environment",
    });

    expect(capturedQuery).toBeDefined();
    const queryObj = capturedQuery as { $or?: Array<{ prompt?: RegExp; content?: RegExp }> };
    expect(queryObj.$or).toHaveLength(2);
    expect(queryObj.$or?.[0].prompt?.source).toBe("environment");
    expect(queryObj.$or?.[0].prompt?.flags).toContain("i");
    expect(queryObj.$or?.[1].content?.source).toBe("environment");
    expect(queryObj.$or?.[1].content?.flags).toContain("i");
  });
});
