import { requireUser } from "../../common/middlewares/auth.middleware.js";
import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as analyticsService from "./analytics.service.js";
import type { StudentProgressQueryInput } from "./analytics.validation.js";


export async function getExamAnalytics(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await analyticsService.getExamAnalytics(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function getClassAnalytics(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await analyticsService.getClassAnalytics(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function getStudentProgress(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as StudentProgressQueryInput;
  const result = await analyticsService.getStudentProgress(
    { id: user.id, role: user.role },
    query
  );
  sendSuccess(res, result);
}
