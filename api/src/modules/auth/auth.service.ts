import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../common/errors/AppError.js";
import { UserModel, type IUser } from "../users/user.model.js";
import type { ChangePasswordBody, LoginBody, RegisterBody } from "./auth.validation.js";

const BCRYPT_SALT_ROUNDS = 12;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function buildPayload(user: IUser) {
  return {
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
  };
}

export function signAccessToken(user: IUser): string {
  return jwt.sign(buildPayload(user), env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(user: IUser): string {
  return jwt.sign(buildPayload(user), env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function generateTokens(user: IUser): AuthTokens {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export async function register(data: RegisterBody): Promise<{ user: IUser } & AuthTokens> {
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
    targetBand: data.targetBand,
    role: "student",
    status: "active",
  });

  return { user, ...generateTokens(user) };
}

export async function login(data: LoginBody): Promise<{ user: IUser } & AuthTokens> {
  const user = await UserModel.findOne({ email: data.email.toLowerCase().trim() });

  if (!user || user.status === "suspended") {
    throw new BadRequestError("INVALID_CREDENTIALS", "Sai email hoặc mật khẩu.");
  }

  const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);
  if (!isPasswordValid) {
    throw new BadRequestError("INVALID_CREDENTIALS", "Sai email hoặc mật khẩu.");
  }

  return { user, ...generateTokens(user) };
}

export async function refresh(refreshToken: string | undefined): Promise<{ accessToken: string }> {
  if (!refreshToken) {
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  let payload: { sub: string; role: string; email: string };

  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
      sub: string;
      role: string;
      email: string;
    };
  } catch {
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  const user = await UserModel.findById(payload.sub);
  if (!user || user.status === "suspended") {
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  return { accessToken: signAccessToken(user) };
}

export async function changePassword(
  userId: string,
  data: ChangePasswordBody
): Promise<void> {
  const user = await UserModel.findById(userId);

  if (!user) {
    throw new UnauthorizedError("UNAUTHORIZED", "Tài khoản không tồn tại.");
  }

  const isOldPasswordValid = await bcrypt.compare(data.oldPassword, user.passwordHash);
  if (!isOldPasswordValid) {
    throw new BadRequestError("OLD_PASSWORD_INCORRECT", "Mật khẩu cũ không chính xác.");
  }

  user.passwordHash = await bcrypt.hash(data.newPassword, BCRYPT_SALT_ROUNDS);
  await user.save();
}
