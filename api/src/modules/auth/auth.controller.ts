import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import { toSafeUser } from "../users/user.serializer.js";
import * as authService from "./auth.service.js";

const REFRESH_COOKIE_NAME = "refreshToken";
export const REFRESH_COOKIE_PATH = "/api/auth";
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { user, accessToken, refreshToken } = await authService.register(
    req.body,
    req.get("user-agent") ?? undefined
  );

  setRefreshCookie(res, refreshToken);
  sendSuccess(res, { user: toSafeUser(user), accessToken }, 201);
}

export async function login(req: Request, res: Response): Promise<void> {
  const { user, accessToken, refreshToken } = await authService.login(
    req.body,
    req.get("user-agent") ?? undefined
  );

  setRefreshCookie(res, refreshToken);
  sendSuccess(res, { user: toSafeUser(user), accessToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  if (!token) {
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "Refresh Token không hợp lệ.");
  }

  const { accessToken, refreshToken } = await authService.refresh(
    token,
    req.get("user-agent") ?? undefined
  );

  // FIX-04: rotate the refresh cookie alongside the access token.
  setRefreshCookie(res, refreshToken);
  sendSuccess(res, { accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  // FIX-04: revoke the session server-side (idempotent) before clearing cookie.
  await authService.logout(token);
  clearRefreshCookie(res);
  sendSuccess(res, { message: "Đăng xuất thành công" });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError("UNAUTHORIZED", "Token không hợp lệ hoặc thiếu Authorization Header.");
  }

  await authService.changePassword(userId, req.body);
  sendSuccess(res, { message: "Đổi mật khẩu thành công" });
}
