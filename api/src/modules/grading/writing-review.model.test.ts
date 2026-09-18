import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { WritingReviewModel } from "./writing-review.model.js";

function baseFields() {
  return {
    attemptId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    teacherId: new mongoose.Types.ObjectId(),
  };
}

describe("WritingReviewModel", () => {
  it("registers the expected schema paths", () => {
    expect(WritingReviewModel.modelName).toBe("WritingReview");
    expect(WritingReviewModel.schema.path("attemptId")).toBeDefined();
    expect(WritingReviewModel.schema.path("studentId")).toBeDefined();
    expect(WritingReviewModel.schema.path("teacherId")).toBeDefined();
    expect(WritingReviewModel.schema.path("task1.score")).toBeDefined();
    expect(WritingReviewModel.schema.path("task1.comment")).toBeDefined();
    expect(WritingReviewModel.schema.path("task2.score")).toBeDefined();
    expect(WritingReviewModel.schema.path("task2.comment")).toBeDefined();
    expect(WritingReviewModel.schema.path("overallWritingScore")).toBeDefined();
    expect(WritingReviewModel.schema.path("generalFeedback")).toBeDefined();
  });

  it("requires attemptId, studentId, teacherId and overallWritingScore", async () => {
    let error: ValidationError | undefined;
    try {
      await new WritingReviewModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.attemptId).toBeDefined();
    expect(error?.errors.studentId).toBeDefined();
    expect(error?.errors.teacherId).toBeDefined();
    expect(error?.errors.overallWritingScore).toBeDefined();
  });

  it("requires task1.score and task2.score", async () => {
    let error: ValidationError | undefined;
    try {
      await new WritingReviewModel({
        ...baseFields(),
        task1: {},
        task2: {},
        overallWritingScore: 6.5,
      }).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors["task1.score"]).toBeDefined();
    expect(error?.errors["task2.score"]).toBeDefined();
  });

  it("rejects scores outside the 0-9 band", async () => {
    let error: ValidationError | undefined;
    try {
      await new WritingReviewModel({
        ...baseFields(),
        task1: { score: 9.5 },
        task2: { score: -0.5 },
        overallWritingScore: 10,
      }).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors["task1.score"]).toBeDefined();
    expect(error?.errors["task2.score"]).toBeDefined();
    expect(error?.errors.overallWritingScore).toBeDefined();
  });

  it("rejects scores that are not multiples of 0.5", async () => {
    let error: ValidationError | undefined;
    try {
      await new WritingReviewModel({
        ...baseFields(),
        task1: { score: 6.3 },
        task2: { score: 7 },
        overallWritingScore: 6.8,
      }).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors["task1.score"]).toBeDefined();
    expect(error?.errors.overallWritingScore).toBeDefined();
    expect(error?.errors["task2.score"]).toBeUndefined();
  });

  it("accepts a valid review when optional comments are omitted", async () => {
    const doc = new WritingReviewModel({
      ...baseFields(),
      task1: { score: 6 },
      task2: { score: 7 },
      overallWritingScore: 6.5,
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.task1?.score).toBe(6);
    expect(doc.task1?.comment).toBeUndefined();
    expect(doc.generalFeedback).toBeUndefined();
  });

  it("accepts a review with only task1 or only task2", async () => {
    const doc1 = new WritingReviewModel({
      ...baseFields(),
      task1: { score: 6.5 },
      overallWritingScore: 6.5,
    });
    await expect(doc1.validate()).resolves.toBeUndefined();

    const doc2 = new WritingReviewModel({
      ...baseFields(),
      task2: { score: 7.0 },
      overallWritingScore: 7.0,
    });
    await expect(doc2.validate()).resolves.toBeUndefined();
  });

  it("rejects a review when both task1 and task2 are omitted", async () => {
    let error: ValidationError | undefined;
    try {
      await new WritingReviewModel({
        ...baseFields(),
        overallWritingScore: 6.5,
      }).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.task1).toBeDefined();
  });

  it("registers a unique index on attemptId", () => {
    const indexes = WritingReviewModel.schema.indexes();
    const uniqueAttemptIndex = indexes.find(
      ([fields, options]) =>
        options?.unique === true &&
        (fields as { attemptId?: number }).attemptId === 1
    );

    expect(uniqueAttemptIndex).toBeDefined();
  });
});
