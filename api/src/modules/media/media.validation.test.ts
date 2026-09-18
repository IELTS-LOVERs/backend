import { describe, expect, it } from "vitest";
import { PresignUploadSchema } from "./media.validation.js";

function validPayload() {
  return {
    body: {
      filename: "listening-part1.mp3",
      mimeType: "audio/mpeg",
      type: "audio",
      size: 5 * 1024 * 1024,
    },
  };
}

describe("PresignUploadSchema", () => {
  it("accepts a valid audio upload payload", () => {
    expect(PresignUploadSchema.safeParse(validPayload()).success).toBe(true);
  });

  it("accepts a valid image upload payload", () => {
    const result = PresignUploadSchema.safeParse({
      body: {
        filename: "chart.png",
        mimeType: "image/png",
        type: "image",
        size: 2048,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a mimeType outside the enum", () => {
    const result = PresignUploadSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, mimeType: "video/mp4" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a type outside audio/image", () => {
    const result = PresignUploadSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, type: "video" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a size greater than 100MB", () => {
    const result = PresignUploadSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, size: 100 * 1024 * 1024 + 1 },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-positive size", () => {
    const result = PresignUploadSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, size: 0 },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing filename", () => {
    const result = PresignUploadSchema.safeParse({
      body: {
        mimeType: "audio/mpeg",
        type: "audio",
        size: 1024,
      },
    });

    expect(result.success).toBe(false);
  });
});
