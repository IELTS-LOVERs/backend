import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import { toSafeUser } from "./user.serializer.js";
import * as userService from "./user.service.js";

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

export async function adminResetPassword(req: Request, res: Response): Promise<void> {
  const userId = req.params.id as string;
  await userService.resetPassword(userId, req.body.newPassword);
  sendSuccess(res, { message: "Đặt lại mật khẩu người dùng thành công" });
}
