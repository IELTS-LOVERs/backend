import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { env } from "../../config/env.js";
import { minioClient } from "../../config/minio.js";
import { MediaModel, type MediaType } from "./media.model.js";
import type { ListMediaQuery, PresignUploadBody } from "./media.validation.js";

export const PRESIGN_EXPIRES_IN_SECONDS = 15 * 60;

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

  const media = await MediaModel.create({
    bucket: env.MINIO_BUCKET,
    key,
    originalName: data.filename,
    mimeType: data.mimeType,
    size: data.size,
    type: data.type,
    uploadedBy: new mongoose.Types.ObjectId(userId),
  });

  const uploadUrl = await minioClient.presignedPutObject(
    env.MINIO_BUCKET,
    key,
    PRESIGN_EXPIRES_IN_SECONDS
  );

  return {
    mediaId: media._id.toString(),
    uploadUrl,
    publicUrl: `${env.PUBLIC_MEDIA_URL}/${key}`,
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

  return {
    items: items.map((item) => ({
      id: item._id.toString(),
      bucket: item.bucket,
      key: item.key,
      originalName: item.originalName,
      mimeType: item.mimeType,
      size: item.size,
      type: item.type,
      url: `${env.PUBLIC_MEDIA_URL}/${item.key}`,
      uploadedBy: item.uploadedBy.toString(),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
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

  try {
    await minioClient.removeObject(env.MINIO_BUCKET, media.key);
  } catch {
    // MinIO object might already be gone
  }

  await MediaModel.findByIdAndDelete(id);
}
