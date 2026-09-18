import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { ClassModel } from "./class.model.js";

describe("ClassModel", () => {
  it("registers the expected schema paths", () => {
    expect(ClassModel.modelName).toBe("Class");
    expect(ClassModel.schema.path("name")).toBeDefined();
    expect(ClassModel.schema.path("code")).toBeDefined();
    expect(ClassModel.schema.path("description")).toBeDefined();
    expect(ClassModel.schema.path("teacherId")).toBeDefined();
    expect(ClassModel.schema.path("students")).toBeDefined();
  });

  it("requires name, code and teacherId", async () => {
    let error: ValidationError | undefined;
    try {
      await new ClassModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.name).toBeDefined();
    expect(error?.errors.code).toBeDefined();
    expect(error?.errors.teacherId).toBeDefined();
  });

  it("accepts a valid class document", async () => {
    const doc = new ClassModel({
      name: "IELTS Intensive K12",
      code: "KH79E2",
      teacherId: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.code).toBe("KH79E2");
    expect(doc.students).toHaveLength(0);
  });
});
