import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { ExamEventModel } from "./exam-event.model.js";

function baseFields() {
  return {
    attemptId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    type: "TAB_SWITCH",
  };
}

describe("ExamEventModel", () => {
  it("registers the expected schema paths", () => {
    expect(ExamEventModel.modelName).toBe("ExamEvent");
    expect(ExamEventModel.schema.path("attemptId")).toBeDefined();
    expect(ExamEventModel.schema.path("studentId")).toBeDefined();
    expect(ExamEventModel.schema.path("type")).toBeDefined();
    expect(ExamEventModel.schema.path("timestamp")).toBeDefined();
    expect(ExamEventModel.schema.path("metadata")).toBeDefined();
  });

  it("requires attemptId, studentId and type", async () => {
    let error: ValidationError | undefined;
    try {
      await new ExamEventModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.attemptId).toBeDefined();
    expect(error?.errors.studentId).toBeDefined();
    expect(error?.errors.type).toBeDefined();
  });

  it("rejects a type outside the enum", async () => {
    let error: ValidationError | undefined;
    try {
      await new ExamEventModel({ ...baseFields(), type: "SCREENSHOT" }).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.type).toBeDefined();
  });

  it("defaults timestamp to now and metadata to an empty object", async () => {
    const doc = new ExamEventModel(baseFields());

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.timestamp).toBeInstanceOf(Date);
    expect(doc.metadata).toEqual({});
  });

  it("does not track updatedAt", async () => {
    const doc = new ExamEventModel(baseFields());
    await doc.validate();

    expect((doc as unknown as { updatedAt?: Date }).updatedAt).toBeUndefined();
  });

  it("keeps the provided timestamp and metadata", async () => {
    const timestamp = new Date("2026-09-18T10:00:00.000Z");
    const doc = new ExamEventModel({
      ...baseFields(),
      timestamp,
      metadata: { clientTime: "ignored" },
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.timestamp.toISOString()).toBe(timestamp.toISOString());
    expect(doc.metadata).toEqual({ clientTime: "ignored" });
  });
});
