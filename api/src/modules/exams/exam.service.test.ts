import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../common/errors/AppError.js";
import { assertOwnership, mapSections, serializeQuestion } from "./exam.service.js";

describe("mapSections", () => {
  it("converts hex strings to ObjectIds for mediaIds and questionIds", () => {
    const q1 = new mongoose.Types.ObjectId().toString();
    const q2 = new mongoose.Types.ObjectId().toString();
    const m1 = new mongoose.Types.ObjectId().toString();

    const sections = mapSections([
      {
        skill: "listening",
        part: 1,
        title: "Section 1",
        instructions: "Listen carefully",
        passageText: undefined,
        mediaIds: [m1],
        questionIds: [q1, q2],
      },
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].skill).toBe("listening");
    expect(sections[0].part).toBe(1);
    expect(sections[0].questionIds[0]).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(sections[0].questionIds[0].toString()).toBe(q1);
    expect(sections[0].questionIds[1].toString()).toBe(q2);
    expect(sections[0].mediaIds?.[0].toString()).toBe(m1);
  });
});

describe("assertOwnership", () => {
  const creatorId = new mongoose.Types.ObjectId();

  it("permits admin role to manage any exam", () => {
    const exam = { createdBy: creatorId };
    expect(() => assertOwnership(exam, "admin-user", "admin")).not.toThrow();
  });

  it("permits the creator teacher to manage their exam", () => {
    const exam = { createdBy: creatorId };
    expect(() => assertOwnership(exam, creatorId.toString(), "teacher")).not.toThrow();
  });

  it("throws ForbiddenError for a non-owner teacher", () => {
    const exam = { createdBy: creatorId };
    expect(() => assertOwnership(exam, "stranger-teacher", "teacher")).toThrow(ForbiddenError);
  });
});

describe("serializeQuestion", () => {
  it("serializes populated question into expected response shape", () => {
    const qId = new mongoose.Types.ObjectId();
    const cId = new mongoose.Types.ObjectId();
    const now = new Date();

    const serialized = serializeQuestion({
      _id: qId,
      skill: "reading",
      type: "true_false_not_given",
      part: 2,
      prompt: "Is the statement true?",
      content: undefined,
      data: {},
      acceptedAnswers: ["TRUE"],
      points: 1,
      explanation: undefined,
      mediaIds: [],
      createdBy: cId,
      createdAt: now,
      updatedAt: now,
    });

    expect(serialized.id).toBe(qId.toString());
    expect(serialized.skill).toBe("reading");
    expect(serialized.content).toBeNull();
    expect(serialized.explanation).toBeNull();
    expect(serialized.createdBy).toBe(cId.toString());
  });
});
