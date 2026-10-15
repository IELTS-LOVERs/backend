import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { QuestionModel } from "./question.model.js";

describe("QuestionModel", () => {
  it("registers the expected schema paths", () => {
    expect(QuestionModel.modelName).toBe("Question");
    expect(QuestionModel.schema.path("skill")).toBeDefined();
    expect(QuestionModel.schema.path("part")).toBeDefined();
    expect(QuestionModel.schema.path("groupType")).toBeDefined();
    expect(QuestionModel.schema.path("instructions")).toBeDefined();
    expect(QuestionModel.schema.path("config")).toBeDefined();
    expect(QuestionModel.schema.path("questions")).toBeDefined();
    expect(QuestionModel.schema.path("createdBy")).toBeDefined();
  });

  it("requires skill, part, groupType, createdBy and at least one question", async () => {
    let error: ValidationError | undefined;
    try {
      await new QuestionModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.skill).toBeDefined();
    expect(error?.errors.part).toBeDefined();
    expect(error?.errors.groupType).toBeDefined();
    expect(error?.errors.createdBy).toBeDefined();
    expect(error?.errors.questions).toBeDefined();
  });

  it("applies defaults for instructions, config and question items", async () => {
    const doc = new QuestionModel({
      skill: "listening",
      part: 1,
      groupType: "form_completion",
      createdBy: new mongoose.Types.ObjectId(),
      questions: [{ prompt: "City: [1]" }],
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.instructions).toBe("");
    expect(doc.config).toEqual({});
    expect(doc.questions).toHaveLength(1);
    expect(doc.questions[0].points).toBe(1);
    expect(doc.questions[0].acceptedAnswers).toHaveLength(0);
  });
});
