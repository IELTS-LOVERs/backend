import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as dashboardService from "./dashboard.service.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function getStudentDashboard(
  req: Request,
  res: Response
): Promise<void> {
  const user = requireUser(req);
  const result = await dashboardService.getStudentDashboard(user.id);
  sendSuccess(res, result);
}

export async function getTeacherDashboard(
  req: Request,
  res: Response
): Promise<void> {
  const user = requireUser(req);
  const result = await dashboardService.getTeacherDashboard(user.id, user.role);
  sendSuccess(res, result);
}
