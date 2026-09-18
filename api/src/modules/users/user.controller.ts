import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import { toSafeUser } from "./user.serializer.js";
import * as userService from "./user.service.js";
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserStatusBody,
} from "./user.validation.js";

export async function getMe(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }

  const user = await userService.getProfile(userId);
  sendSuccess(res, toSafeUser(user));
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }

  const user = await userService.updateProfile(userId, req.body);
  sendSuccess(res, toSafeUser(user));
}

export async function adminResetPassword(req: Request, res: Response): Promise<void> {
  const userId = req.params.id as string;
  await userService.resetPassword(userId, req.body.newPassword);
  sendSuccess(res, { message: "Đặt lại mật khẩu người dùng thành công" });
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListUsersQuery;
  const result = await userService.listUsers(query);
  sendSuccess(res, result.users.map(toSafeUser), 200, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
  });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateUserBody;
  const user = await userService.createUser(body);
  sendSuccess(res, toSafeUser(user), 201);
}

export async function updateUserStatus(req: Request, res: Response): Promise<void> {
  const userId = req.params.id as string;
  const body = req.body as UpdateUserStatusBody;
  const user = await userService.updateUserStatus(userId, body.status);
  sendSuccess(res, toSafeUser(user));
}
