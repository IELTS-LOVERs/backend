import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { AssignmentModel } from "./assignment.model.js";

describe("AssignmentModel", () => {
  it("registers the expected schema paths", () => {
    expect(AssignmentModel.modelName).toBe("Assignment");
    expect(AssignmentModel.schema.path("examId")).toBeDefined();
    expect(AssignmentModel.schema.path("teacherId")).toBeDefined();
    expect(AssignmentModel.schema.path("classId")).toBeDefined();
    expect(AssignmentModel.schema.path("studentId")).toBeDefined();
    expect(AssignmentModel.schema.path("assignedAt")).toBeDefined();
    expect(AssignmentModel.schema.path("deadline")).toBeDefined();
    expect(AssignmentModel.schema.path("status")).toBeDefined();
  });

  it("requires examId and teacherId", async () => {
    let error: ValidationError | undefined;
    try {
      await new AssignmentModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.examId).toBeDefined();
    expect(error?.errors.teacherId).toBeDefined();
  });

  it("applies defaults for assignedAt and status", async () => {
    const doc = new AssignmentModel({
      examId: new mongoose.Types.ObjectId(),
      teacherId: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.status).toBe("active");
    expect(doc.assignedAt).toBeInstanceOf(Date);
  });
});
