import bcrypt from "bcrypt";
import { NotFoundError } from "../../common/errors/AppError.js";
import { UserModel, type IUser } from "./user.model.js";

const BCRYPT_SALT_ROUNDS = 12;

export async function getProfile(userId: string): Promise<IUser> {
  const user = await UserModel.findById(userId).select("-passwordHash");

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  return user;
}

export async function resetPassword(userId: string, newPassword: string): Promise<void> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await user.save();
}
