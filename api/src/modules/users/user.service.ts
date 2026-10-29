import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { escapeRegExp } from "../../common/utils/escape-regexp.js";
import { logger } from "../../common/utils/logger.js";
import { ClassModel } from "../classes/class.model.js";
import { UserModel, type IUser, type UserStatus } from "./user.model.js";
import type {
  CreateUserBody,
  ListStudentsQuery,
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

export interface StudentClassRef {
  id: string;
  name: string;
  code: string;
}

export interface RegisteredStudent {
  user: IUser;
  /** Các lớp học sinh đang thuộc về (rỗng = chưa vào lớp nào). */
  classes: StudentClassRef[];
}

export interface ListStudentsResult {
  students: RegisteredStudent[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Danh sách tài khoản học sinh đã đăng ký, kèm lớp hiện tại.
 *
 * Giáo viên dùng danh sách này để biết bạn nào đã có tài khoản mà chưa vào lớp
 * (bộ lọc `unassigned`) rồi thêm vào lớp bằng email.
 */
export async function listRegisteredStudents(
  filters: ListStudentsQuery
): Promise<ListStudentsResult> {
  const query: Record<string, unknown> = { role: "student" };

  if (filters.status) query.status = filters.status;

  if (filters.search && filters.search.trim().length > 0) {
    const searchRegex = new RegExp(escapeRegExp(filters.search.trim()), "i");
    query.$or = [{ email: searchRegex }, { fullName: searchRegex }];
  }

  if (filters.unassigned) {
    // Chỉ lấy học sinh chưa thuộc bất kỳ lớp nào.
    const enrolledStudentIds = await ClassModel.distinct("students");
    query._id = { $nin: enrolledStudentIds };
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

  const classesByStudent = await getClassesByStudent(
    users.map((user) => user._id.toString())
  );

  return {
    students: users.map((user) => ({
      user,
      classes: classesByStudent.get(user._id.toString()) ?? [],
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

/** Gom lớp của từng học sinh trong một truy vấn (tránh N+1). */
async function getClassesByStudent(
  studentIds: string[]
): Promise<Map<string, StudentClassRef[]>> {
  const result = new Map<string, StudentClassRef[]>();
  const validIds = studentIds.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) return result;

  const classes = await ClassModel.find({
    students: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) },
  })
    .select("name code students")
    .sort({ name: 1 });

  const wanted = new Set(validIds);
  for (const cls of classes) {
    const ref: StudentClassRef = {
      id: cls._id.toString(),
      name: cls.name,
      code: cls.code,
    };

    for (const studentId of cls.students) {
      const key = studentId.toString();
      if (!wanted.has(key)) continue;
      const list = result.get(key);
      if (list) list.push(ref);
      else result.set(key, [ref]);
    }
  }

  return result;
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
