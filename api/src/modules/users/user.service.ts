import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import { logger } from "../../common/utils/logger.js";
import { UserModel, type IUser, type UserStatus } from "./user.model.js";
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateProfileBody,
} from "./user.validation.js";

const BCRYPT_SALT_ROUNDS = 12;

export async function getProfile(userId: string): Promise<IUser> {
  const user = await UserModel.findById(userId).select("-passwordHash");

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  return user;
}

export async function updateProfile(
  userId: string,
  data: UpdateProfileBody
): Promise<IUser> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  if (data.fullName !== undefined) user.fullName = data.fullName;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.targetBand !== undefined) user.targetBand = data.targetBand;
  if (data.avatarMediaId !== undefined) {
    user.avatarMediaId = data.avatarMediaId && mongoose.isValidObjectId(data.avatarMediaId)
      ? new mongoose.Types.ObjectId(data.avatarMediaId)
      : undefined;
  }

  await user.save();

  const updated = await UserModel.findById(userId).select("-passwordHash");
  return updated!;
}

export async function resetPassword(userId: string, newPassword: string): Promise<void> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  // FIX-04: admin password reset invalidates every refresh session.
  user.refreshSessions = [];
  user.activeSessionId = undefined;
  await user.save();

  logger.info("auth.admin_password_reset", { userId });
}

export interface ListUsersResult {
  users: IUser[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listUsers(filters: ListUsersQuery): Promise<ListUsersResult> {
  const query: Record<string, unknown> = {};

  if (filters.role) query.role = filters.role;
  if (filters.status) query.status = filters.status;

  if (filters.search && filters.search.trim().length > 0) {
    const searchRegex = new RegExp(escapeRegExp(filters.search.trim()), "i");
    query.$or = [{ email: searchRegex }, { fullName: searchRegex }];
  }

  const { page, limit } = filters;

  const [users, total] = await Promise.all([
    UserModel.find(query)
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    UserModel.countDocuments(query),
  ]);

  return {
    users,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function createUser(data: CreateUserBody): Promise<IUser> {
  const email = data.email.toLowerCase().trim();

  const existing = await UserModel.findOne({ email });
  if (existing) {
    throw new ConflictError("CONFLICT", "Email đã tồn tại.");
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

  const user = await UserModel.create({
    email,
    passwordHash,
    fullName: data.fullName,
    phone: data.phone,
    role: data.role,
    targetBand: data.targetBand,
    status: "active",
  });

  logger.info("users.created", { userId: user._id.toString(), role: user.role });

  return user;
}

export async function updateUserStatus(
  userId: string,
  status: UserStatus
): Promise<IUser> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  user.status = status;

  if (status === "suspended") {
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    // FIX-04: suspension revokes every refresh session for the account.
    user.refreshSessions = [];
    user.activeSessionId = undefined;
  }

  await user.save();

  logger.info("users.status_updated", { userId, status });

  return user;
}

/**
 * Admin chủ động đăng xuất một người dùng khỏi mọi thiết bị.
 * Tăng tokenVersion để vô hiệu hoá luôn access token đang lưu hành.
 */
export async function revokeSessions(userId: string): Promise<void> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  user.refreshSessions = [];
  user.activeSessionId = undefined;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  logger.info("auth.admin_revoke_sessions", { userId });
}
