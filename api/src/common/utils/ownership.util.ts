import type { Types } from "mongoose";
import { ForbiddenError } from "../errors/AppError.js";

/**
 * Minimal shape shared by resources that belong to a teacher
 * (classes expose `teacherId`, exams expose `createdBy`).
 */
export interface OwnedResource {
  teacherId?: Types.ObjectId | string | null;
  createdBy?: Types.ObjectId | string | null;
}

/**
 * Throws 403 unless the caller is an admin or owns the resource.
 * Was duplicated in the class and exam services.
 */
export function assertOwnership(
  resource: OwnedResource,
  userId: string,
  role: string
): void {
  if (role === "admin") return;

  const ownerId = resource.teacherId ?? resource.createdBy;

  if (ownerId?.toString() !== userId) {
    throw new ForbiddenError(
      "FORBIDDEN",
      "Người dùng không đủ quyền thực hiện hành động."
    );
  }
}
