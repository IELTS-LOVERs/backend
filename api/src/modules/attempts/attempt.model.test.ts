import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { AttemptModel } from "./attempt.model.js";

describe("AttemptModel", () => {
  it("registers the expected schema paths", () => {
    expect(AttemptModel.modelName).toBe("Attempt");
    expect(AttemptModel.schema.path("examId")).toBeDefined();
    expect(AttemptModel.schema.path("studentId")).toBeDefined();
    expect(AttemptModel.schema.path("assignmentId")).toBeDefined();
    expect(AttemptModel.schema.path("startedAt")).toBeDefined();
    expect(AttemptModel.schema.path("expiresAt")).toBeDefined();
    expect(AttemptModel.schema.path("submittedAt")).toBeDefined();
    expect(AttemptModel.schema.path("status")).toBeDefined();
    expect(AttemptModel.schema.path("answers")).toBeDefined();
    expect(AttemptModel.schema.path("answers.questionId")).toBeDefined();
    expect(AttemptModel.schema.path("answers.value")).toBeDefined();
    expect(AttemptModel.schema.path("answers.savedAt")).toBeDefined();
    expect(AttemptModel.schema.path("scores.listeningRaw")).toBeDefined();
    expect(AttemptModel.schema.path("scores.listeningBand")).toBeDefined();
    expect(AttemptModel.schema.path("scores.readingRaw")).toBeDefined();
    expect(AttemptModel.schema.path("scores.readingBand")).toBeDefined();
    expect(AttemptModel.schema.path("scores.writingTask1Band")).toBeDefined();
    expect(AttemptModel.schema.path("scores.writingTask2Band")).toBeDefined();
    expect(AttemptModel.schema.path("scores.writingBand")).toBeDefined();
    expect(AttemptModel.schema.path("scores.overallBand")).toBeDefined();
    expect(AttemptModel.schema.path("suspicious")).toBeDefined();
    expect(AttemptModel.schema.path("questionOrder")).toBeDefined();
    expect(AttemptModel.schema.path("examKind")).toBeDefined();
    expect(AttemptModel.schema.path("skills")).toBeDefined();
    expect(AttemptModel.schema.path("questionCount")).toBeDefined();
  });

  it("requires examId, studentId and expiresAt", async () => {
    let error: ValidationError | undefined;
    try {
      await new AttemptModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.examId).toBeDefined();
    expect(error?.errors.studentId).toBeDefined();
    expect(error?.errors.expiresAt).toBeDefined();
  });

  it("applies defaults for startedAt, status, answers, suspicious, examKind and questionCount", async () => {
    const doc = new AttemptModel({
      examId: new mongoose.Types.ObjectId(),
      studentId: new mongoose.Types.ObjectId(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.startedAt).toBeInstanceOf(Date);
    expect(doc.status).toBe("in_progress");
    expect(doc.answers).toHaveLength(0);
    expect(doc.suspicious).toBe(false);
    expect(doc.questionOrder).toHaveLength(0);
    expect(doc.examKind).toBe("mock");
    expect(doc.questionCount).toBe(0);
    expect(doc.scores.listeningRaw).toBeUndefined();
    expect(doc.scores.overallBand).toBeUndefined();
  });

  it("registers a unique partial index for in-progress attempts", () => {
    const indexes = AttemptModel.schema.indexes();
    const uniqueInProgress = indexes.find(
      ([, options]) =>
        options?.unique === true &&
        options?.partialFilterExpression !== undefined &&
        (options.partialFilterExpression as { status?: string }).status === "in_progress"
    );

    expect(uniqueInProgress).toBeDefined();
  });
});
