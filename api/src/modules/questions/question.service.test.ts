import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import type { IQuestion } from "./question.model.js";
import { assertOwner, serializeQuestion } from "./question.service.js";

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
