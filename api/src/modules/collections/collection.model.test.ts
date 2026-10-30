import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { CollectionModel } from "./collection.model.js";

describe("CollectionModel", () => {
  it("registers the expected schema paths", () => {
    expect(CollectionModel.modelName).toBe("Collection");
    expect(CollectionModel.schema.path("name")).toBeDefined();
    expect(CollectionModel.schema.path("parentId")).toBeDefined();
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

  it("applies defaults for parentId (null) and orderIndex (0)", async () => {
    const doc = new CollectionModel({
      name: "Cambridge IELTS 18",
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.parentId).toBeNull();
    expect(doc.orderIndex).toBe(0);
  });

  it("accepts parentId as ObjectId", async () => {
    const parentId = new mongoose.Types.ObjectId();
    const doc = new CollectionModel({
      name: "Cambridge IELTS 18",
      parentId,
      createdBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.parentId?.toString()).toBe(parentId.toString());
  });
});
