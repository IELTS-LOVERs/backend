import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { CollectionModel } from "./collection.model.js";

describe("CollectionModel", () => {
  it("registers the expected schema paths", () => {
    expect(CollectionModel.modelName).toBe("Collection");
    expect(CollectionModel.schema.path("name")).toBeDefined();
    expect(CollectionModel.schema.path("category")).toBeDefined();
    expect(CollectionModel.schema.path("description")).toBeDefined();
    expect(CollectionModel.schema.path("bannerUrl")).toBeDefined();
    expect(CollectionModel.schema.path("orderIndex")).toBeDefined();
    expect(CollectionModel.schema.path("createdBy")).toBeDefined();
  });

  it("requires name and createdBy", async () => {
    let error: ValidationError | undefined;
    try {
      await new CollectionModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.name).toBeDefined();
    expect(error?.errors.createdBy).toBeDefined();
  });

  it("applies defaults for category and orderIndex", async () => {
    const doc = new CollectionModel({
      name: "Cambridge IELTS 18",
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.category).toBe("Giáo trình trung tâm");
    expect(doc.orderIndex).toBe(0);
  });

  it("accepts custom categories", async () => {
    const doc = new CollectionModel({
      name: "Cambridge IELTS 18",
      category: "IELTS Forecast Quý 1",
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.category).toBe("IELTS Forecast Quý 1");
  });
});
