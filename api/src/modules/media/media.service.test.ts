import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ForbiddenError } from "../../common/errors/AppError.js";
import { minioClient } from "../../config/minio.js";
import { ExamModel } from "../exams/exam.model.js";
import { QuestionModel } from "../questions/question.model.js";
import { MediaModel } from "./media.model.js";
import {
  buildMediaObjectKey,
  confirmUpload,
  deleteMedia,
  listMedia,
  sanitizeFilename,
} from "./media.service.js";

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

describe("listMedia", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();

  it("filters by uploadedBy for teacher and includes public url", async () => {
    const mockMediaDoc = {
      _id: new mongoose.Types.ObjectId(),
      bucket: "ielts-media",
      key: "uploads/audio/test.mp3",
      originalName: "test.mp3",
      mimeType: "audio/mpeg",
      size: 1024,
      type: "audio" as const,
      uploadedBy: new mongoose.Types.ObjectId(teacherId),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let capturedQuery: unknown;
    vi.spyOn(MediaModel, "find").mockImplementationOnce((query: unknown) => {
      capturedQuery = query;
      return {
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockMediaDoc]),
          }),
        }),
      } as never;
    });
    vi.spyOn(MediaModel, "countDocuments").mockResolvedValueOnce(1 as never);

    const result = await listMedia(teacherId, "teacher", { page: 1, limit: 20 });
    expect((capturedQuery as Record<string, unknown>).uploadedBy).toBeDefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toContain("uploads/audio/test.mp3");
    expect(result.total).toBe(1);
  });

  it("does not filter by uploadedBy for admin", async () => {
    let capturedQuery: unknown;
    vi.spyOn(MediaModel, "find").mockImplementationOnce((query: unknown) => {
      capturedQuery = query;
      return {
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never;
    });
    vi.spyOn(MediaModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await listMedia("admin-id", "admin", { page: 1, limit: 20 });
    expect((capturedQuery as Record<string, unknown>).uploadedBy).toBeUndefined();
  });
});

describe("confirmUpload", () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const mediaId = new mongoose.Types.ObjectId().toString();

  it("marks a pending media record as confirmed after statObject succeeds", async () => {
    const media = {
      _id: mediaId,
      uploadedBy: new mongoose.Types.ObjectId(userId),
      key: "uploads/audio/test.mp3",
      status: "pending" as const,
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(MediaModel, "findById").mockResolvedValueOnce(media as never);
    vi.spyOn(minioClient, "statObject").mockResolvedValueOnce({} as never);

    const result = await confirmUpload(mediaId, userId);

    expect(result.status).toBe("confirmed");
    expect(media.status).toBe("confirmed");
    expect(media.save).toHaveBeenCalledTimes(1);
  });
});

describe("deleteMedia", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();
  const strangerId = new mongoose.Types.ObjectId().toString();
  const mediaId = new mongoose.Types.ObjectId().toString();

  it("throws ForbiddenError when non-owner teacher attempts to delete", async () => {
    vi.spyOn(MediaModel, "findById").mockResolvedValueOnce({
      _id: mediaId,
      uploadedBy: new mongoose.Types.ObjectId(teacherId),
      key: "test.mp3",
    } as never);

    await expect(deleteMedia(mediaId, strangerId, "teacher")).rejects.toThrow(ForbiddenError);
  });

  it("removes object from minio and deletes record when owner deletes", async () => {
    vi.spyOn(MediaModel, "findById").mockResolvedValueOnce({
      _id: mediaId,
      uploadedBy: new mongoose.Types.ObjectId(teacherId),
      key: "test.mp3",
    } as never);
    vi.spyOn(QuestionModel, "exists").mockResolvedValue(null);
    vi.spyOn(ExamModel, "exists").mockResolvedValue(null);
    vi.spyOn(minioClient, "removeObject").mockResolvedValueOnce(undefined as never);
    const deleteSpy = vi.spyOn(MediaModel, "findByIdAndDelete").mockResolvedValueOnce({} as never);

    await deleteMedia(mediaId, teacherId, "teacher");
    expect(minioClient.removeObject).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith(mediaId);
  });

  it("blocks deletion when the media is referenced by a question", async () => {
    vi.spyOn(MediaModel, "findById").mockResolvedValueOnce({
      _id: mediaId,
      uploadedBy: new mongoose.Types.ObjectId(teacherId),
      key: "test.mp3",
    } as never);
    vi.spyOn(QuestionModel, "exists").mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
    });
    vi.spyOn(ExamModel, "exists").mockResolvedValue(null);
    const removeSpy = vi.spyOn(minioClient, "removeObject");
    const deleteSpy = vi.spyOn(MediaModel, "findByIdAndDelete");

    await expect(deleteMedia(mediaId, teacherId, "teacher")).rejects.toThrow(BadRequestError);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("blocks deletion when the media is referenced by an exam section", async () => {
    vi.spyOn(MediaModel, "findById").mockResolvedValueOnce({
      _id: mediaId,
      uploadedBy: new mongoose.Types.ObjectId(teacherId),
      key: "test.mp3",
    } as never);
    vi.spyOn(QuestionModel, "exists").mockResolvedValue(null);
    vi.spyOn(ExamModel, "exists").mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
    });

    await expect(deleteMedia(mediaId, teacherId, "teacher")).rejects.toThrow(/đang được/);
  });

  it("includes group-level config.imageMediaId in the in-use check", async () => {
    vi.spyOn(MediaModel, "findById").mockResolvedValueOnce({
      _id: mediaId,
      uploadedBy: new mongoose.Types.ObjectId(teacherId),
      key: "test.png",
    } as never);
    const questionExists = vi.spyOn(QuestionModel, "exists").mockResolvedValue(null);
    const examExists = vi.spyOn(ExamModel, "exists").mockResolvedValue(null);
    vi.spyOn(minioClient, "removeObject").mockResolvedValueOnce(undefined as never);
    vi.spyOn(MediaModel, "findByIdAndDelete").mockResolvedValueOnce({} as never);

    await deleteMedia(mediaId, teacherId, "teacher");

    expect(JSON.stringify(questionExists.mock.calls.at(-1)?.[0])).toContain(
      "config.imageMediaId"
    );
    expect(JSON.stringify(examExists.mock.calls.at(-1)?.[0])).toContain(
      "sections.questionGroups.config.imageMediaId"
    );
  });
});
