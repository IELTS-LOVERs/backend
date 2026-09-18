import mongoose, { type ValidationError } from "mongoose";
import { describe, expect, it } from "vitest";
import { MediaModel } from "./media.model.js";

describe("MediaModel", () => {
  it("registers the expected schema paths", () => {
    expect(MediaModel.modelName).toBe("Media");
    expect(MediaModel.schema.path("bucket")).toBeDefined();
    expect(MediaModel.schema.path("key")).toBeDefined();
    expect(MediaModel.schema.path("originalName")).toBeDefined();
    expect(MediaModel.schema.path("mimeType")).toBeDefined();
    expect(MediaModel.schema.path("size")).toBeDefined();
    expect(MediaModel.schema.path("type")).toBeDefined();
    expect(MediaModel.schema.path("status")).toBeDefined();
    expect(MediaModel.schema.path("uploadedBy")).toBeDefined();
  });

  it("requires bucket, key, originalName, mimeType, size, type and uploadedBy", async () => {
    let error: ValidationError | undefined;
    try {
      await new MediaModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.bucket).toBeDefined();
    expect(error?.errors.key).toBeDefined();
    expect(error?.errors.originalName).toBeDefined();
    expect(error?.errors.mimeType).toBeDefined();
    expect(error?.errors.size).toBeDefined();
    expect(error?.errors.type).toBeDefined();
    expect(error?.errors.uploadedBy).toBeDefined();
  });

  it("rejects a type outside the audio/image enum", async () => {
    let error: ValidationError | undefined;
    try {
      await new MediaModel({
        bucket: "ielts-media",
        key: "uploads/audio/2026/09/id_part1.mp3",
        originalName: "part1.mp3",
        mimeType: "audio/mpeg",
        size: 1024,
        type: "video",
        uploadedBy: new mongoose.Types.ObjectId(),
      }).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.type).toBeDefined();
  });

  it("accepts a valid media document", async () => {
    const doc = new MediaModel({
      bucket: "ielts-media",
      key: "uploads/audio/2026/09/id_part1.mp3",
      originalName: "part1.mp3",
      mimeType: "audio/mpeg",
      size: 1024,
      type: "audio",
      uploadedBy: new mongoose.Types.ObjectId(),
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.type).toBe("audio");
    expect(doc.status).toBe("pending");
  });

  it("registers a unique index on key", () => {
    const indexes = MediaModel.schema.indexes();
    const uniqueKeyIndex = indexes.find(
      ([fields, options]) =>
        options?.unique === true && (fields as { key?: number }).key === 1
    );

    expect(uniqueKeyIndex).toBeDefined();
  });
});
