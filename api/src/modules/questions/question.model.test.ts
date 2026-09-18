import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { QuestionModel } from "./question.model.js";

describe("QuestionModel", () => {
  it("registers the expected schema paths", () => {
    expect(QuestionModel.modelName).toBe("Question");
    expect(QuestionModel.schema.path("skill")).toBeDefined();
    expect(QuestionModel.schema.path("type")).toBeDefined();
    expect(QuestionModel.schema.path("part")).toBeDefined();
    expect(QuestionModel.schema.path("prompt")).toBeDefined();
    expect(QuestionModel.schema.path("data")).toBeDefined();
    expect(QuestionModel.schema.path("acceptedAnswers")).toBeDefined();
    expect(QuestionModel.schema.path("mediaIds")).toBeDefined();
    expect(QuestionModel.schema.path("createdBy")).toBeDefined();
  });

  it("requires skill, type, part, prompt and createdBy", async () => {
    let error: ValidationError | undefined;
    try {
      await new QuestionModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.skill).toBeDefined();
    expect(error?.errors.type).toBeDefined();
    expect(error?.errors.part).toBeDefined();
    expect(error?.errors.prompt).toBeDefined();
    expect(error?.errors.createdBy).toBeDefined();
  });

  it("applies defaults for points and data", async () => {
    const doc = new QuestionModel({
      skill: "listening",
      type: "form_completion",
      part: 1,
      prompt: "Write NO MORE THAN TWO WORDS.",
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.points).toBe(1);
    expect(doc.data).toEqual({});
    expect(doc.acceptedAnswers).toHaveLength(0);
  });
});
