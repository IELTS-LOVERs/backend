import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { NotFoundError } from "../../common/errors/AppError.js";
import { UserModel, type IUser } from "./user.model.js";
import type { UpdateProfileBody } from "./user.validation.js";

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
  await user.save();
}
