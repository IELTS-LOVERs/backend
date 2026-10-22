import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { ExamModel } from "./exam.model.js";

describe("ExamModel", () => {
  it("registers the expected schema paths", () => {
    expect(ExamModel.modelName).toBe("Exam");
    expect(ExamModel.schema.path("title")).toBeDefined();
    expect(ExamModel.schema.path("description")).toBeDefined();
    expect(ExamModel.schema.path("kind")).toBeDefined();
    expect(ExamModel.schema.path("scoringMode")).toBeDefined();
    expect(ExamModel.schema.path("curriculum.collectionName")).toBeDefined();
    expect(ExamModel.schema.path("curriculum.part")).toBeDefined();
    expect(ExamModel.schema.path("postSubmissionResources.solutionVideoUrl")).toBeDefined();
    expect(ExamModel.schema.path("durationMinutes")).toBeDefined();
    expect(ExamModel.schema.path("sections")).toBeDefined();
    expect(ExamModel.schema.path("status")).toBeDefined();
    expect(ExamModel.schema.path("openAt")).toBeDefined();
    expect(ExamModel.schema.path("closeAt")).toBeDefined();
    expect(ExamModel.schema.path("createdBy")).toBeDefined();
  });

  it("requires title and createdBy", async () => {
    let error: ValidationError | undefined;
    try {
      await new ExamModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.title).toBeDefined();
    expect(error?.errors.createdBy).toBeDefined();
  });

  it("applies defaults for durationMinutes, status, kind, scoringMode and sections", async () => {
    const doc = new ExamModel({
      title: "IELTS Academic Mock Test 01",
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.durationMinutes).toBe(60);
    expect(doc.status).toBe("draft");
    expect(doc.kind).toBe("mock");
    expect(doc.scoringMode).toBe("band");
    expect(doc.type).toBe("mock"); // Virtual
    expect(doc.sections).toHaveLength(0);
  });
});
