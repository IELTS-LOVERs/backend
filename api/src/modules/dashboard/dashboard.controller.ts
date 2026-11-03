import { requireUser } from "../../common/middlewares/auth.middleware.js";
import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as dashboardService from "./dashboard.service.js";


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
