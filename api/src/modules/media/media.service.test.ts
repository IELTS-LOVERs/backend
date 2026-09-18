import { describe, expect, it } from "vitest";
import { buildMediaObjectKey, sanitizeFilename } from "./media.service.js";

describe("sanitizeFilename", () => {
  it("replaces spaces and special characters with a dash", () => {
    expect(sanitizeFilename("Listening Part 1.mp3")).toBe("Listening-Part-1.mp3");
    expect(sanitizeFilename("bài thi!!!.wav")).toBe("b-i-thi-.wav");
  });

  it("keeps alphanumeric characters, dots, underscores and dashes", () => {
    expect(sanitizeFilename("part_1-final.mp3")).toBe("part_1-final.mp3");
  });
});

describe("buildMediaObjectKey", () => {
  it("builds a key under uploads/{type}/{YYYY}/{MM} with a uuid and clean name", () => {
    const key = buildMediaObjectKey(
      "audio",
      "Listening Part 1.mp3",
      new Date("2026-09-18T00:00:00.000Z")
    );

    expect(key.startsWith("uploads/audio/2026/09/")).toBe(true);
    expect(key.endsWith("_Listening-Part-1.mp3")).toBe(true);
    expect(key).toMatch(
      /^uploads\/audio\/2026\/09\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/
    );
  });

  it("uses the image type prefix for images", () => {
    const key = buildMediaObjectKey("image", "chart.png", new Date("2026-01-05T00:00:00.000Z"));

    expect(key.startsWith("uploads/image/2026/01/")).toBe(true);
  });

  it("generates unique keys for the same filename", () => {
    const first = buildMediaObjectKey("audio", "part1.mp3");
    const second = buildMediaObjectKey("audio", "part1.mp3");

    expect(first).not.toBe(second);
  });
});
