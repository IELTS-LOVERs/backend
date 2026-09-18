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
import type { PresignUploadBody } from "./media.validation.js";

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
