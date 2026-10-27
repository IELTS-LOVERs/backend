import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { env } from "../../config/env.js";
import {
  minioClient,
  minioPresignClient,
  presignGetObject,
  publicObjectUrl,
} from "../../config/minio.js";
import { logger } from "../../common/utils/logger.js";
import { ExamModel } from "../exams/exam.model.js";
import { QuestionModel } from "../questions/question.model.js";
import { MediaModel, type MediaType } from "./media.model.js";
import type { ListMediaQuery, PresignUploadBody } from "./media.validation.js";

export const PRESIGN_EXPIRES_IN_SECONDS = 15 * 60;

/** TTL for media-library preview URLs, used only when the bucket is private. */
const MEDIA_GET_URL_EXPIRES_IN_SECONDS = 15 * 60;

export interface PresignedUploadResult {
  mediaId: string;
  uploadUrl: string;
  publicUrl: string;
  expiresInSeconds: number;
}

export interface ConfirmUploadResult {
  id: string;
  status: "confirmed";
}

export interface MediaListItem {
  id: string;
  bucket: string;
  key: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: MediaType;
  status: "pending" | "confirmed";
  url: string;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListMediaResult {
  items: MediaListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Keeps only safe filename characters, collapsing the rest into a dash. */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/** Builds a unique S3 key: uploads/{type}/{YYYY}/{MM}/{uuid}_{cleanFilename}. */
export function buildMediaObjectKey(
  type: MediaType,
  filename: string,
  date: Date = new Date()
): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  return `uploads/${type}/${year}/${month}/${uuidv4()}_${sanitizeFilename(filename)}`;
}

export async function createPresignedUpload(
  data: PresignUploadBody,
  userId: string
): Promise<PresignedUploadResult> {
  const key = buildMediaObjectKey(data.type, data.filename);

  // The DB insert and URL signing are independent. Running them together saves
  // one round-trip before the browser can start the actual file upload.
  const [media, uploadUrl] = await Promise.all([
    MediaModel.create({
      bucket: env.MINIO_BUCKET,
      key,
      originalName: data.filename,
      mimeType: data.mimeType,
      size: data.size,
      type: data.type,
      uploadedBy: new mongoose.Types.ObjectId(userId),
    }),
    // I-2: the upload URL is used by the BROWSER, so it must be signed against
    // the client-reachable endpoint (minioPresignClient), not the internal one.
    minioPresignClient.presignedPutObject(
      env.MINIO_BUCKET,
      key,
      PRESIGN_EXPIRES_IN_SECONDS
    ),
  ]);

  logger.info("media.presigned", { mediaId: media._id.toString(), userId, key });

  return {
    mediaId: media._id.toString(),
    uploadUrl,
    // Permanent public URL: this value gets persisted (exam.bannerUrl, …), so it
    // must not be a presigned URL that expires minutes after upload.
    publicUrl: publicObjectUrl(key)!,
    expiresInSeconds: PRESIGN_EXPIRES_IN_SECONDS,
  };
}

export async function confirmUpload(
  mediaId: string,
  userId: string
): Promise<ConfirmUploadResult> {
  const media = await MediaModel.findById(mediaId);

  if (!media) {
    throw new NotFoundError("Media không tồn tại.");
  }

  if (media.uploadedBy.toString() !== userId) {
    throw new ForbiddenError(
      "FORBIDDEN",
      "Người dùng không đủ quyền thực hiện hành động."
    );
  }

  try {
    await minioClient.statObject(env.MINIO_BUCKET, media.key);
  } catch {
    throw new BadRequestError(
      "MEDIA_NOT_UPLOADED",
      "File chưa được upload lên MinIO."
    );
  }

  media.status = "confirmed";
  await media.save();

  logger.info("media.confirmed", { mediaId, userId, key: media.key });

  return { id: mediaId, status: "confirmed" };
}

export async function listMedia(
  userId: string,
  role: string,
  filters: ListMediaQuery
): Promise<ListMediaResult> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const query: Record<string, unknown> = {};

  if (role !== "admin") {
    query.uploadedBy = new mongoose.Types.ObjectId(userId);
  }

  if (filters.type) {
    query.type = filters.type;
  }

  const [items, total] = await Promise.all([
    MediaModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    MediaModel.countDocuments(query),
  ]);

  const serializedItems: MediaListItem[] = await Promise.all(
    items.map(async (item) => {
      // Private buckets hand out short-lived preview URLs; public buckets use
      // the permanent URL so the media library doesn't hit 403 after 15 min.
      const url =
        env.MINIO_BUCKET_POLICY === "private"
          ? (await presignGetObject(item.key, MEDIA_GET_URL_EXPIRES_IN_SECONDS)) ??
            publicObjectUrl(item.key)!
          : publicObjectUrl(item.key)!;
      return {
        id: item._id.toString(),
        bucket: item.bucket,
        key: item.key,
        originalName: item.originalName,
        mimeType: item.mimeType,
        size: item.size,
        type: item.type,
        status: item.status,
        url,
        uploadedBy: item.uploadedBy.toString(),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    })
  );

  return {
    items: serializedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function deleteMedia(
  id: string,
  userId: string,
  role: string
): Promise<void> {
  const media = await MediaModel.findById(id);

  if (!media) {
    throw new NotFoundError("Media không tồn tại.");
  }

  if (role !== "admin" && media.uploadedBy.toString() !== userId) {
    throw new ForbiddenError(
      "FORBIDDEN",
      "Người dùng không đủ quyền thực hiện hành động."
    );
  }

  const [usedByQuestion, usedByExam] = await Promise.all([
    QuestionModel.exists({
      $or: [
        { "questions.mediaIds": media._id },
        // Group-level image stored as an id string inside the group config.
        { "config.imageMediaId": media._id.toString() },
      ],
    }),
    ExamModel.exists({
      $or: [
        { "sections.mediaIds": media._id },
        { "sections.questionGroups.questions.mediaIds": media._id },
        { "sections.questionGroups.config.imageMediaId": media._id.toString() },
      ],
    }),
  ]);

  if (usedByQuestion || usedByExam) {
    throw new BadRequestError(
      "MEDIA_IN_USE",
      "Không thể xóa media đang được câu hỏi hoặc đề thi sử dụng."
    );
  }

  try {
    await minioClient.removeObject(env.MINIO_BUCKET, media.key);
  } catch {
    // MinIO object might already be gone
  }

  await MediaModel.findByIdAndDelete(id);
}
