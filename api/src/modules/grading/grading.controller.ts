import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as gradingService from "./grading.service.js";
import type { GradeWritingBody } from "./grading.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function getPending(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);
  const { items, totalPending } = await gradingService.getPendingWritingSubmissions(
    user.id,
    user.role,
    {
      page: Number.isFinite(page) && page > 0 ? page : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    }
  );
  sendSuccess(res, items, 200, { totalPending });
}

export async function getForGrading(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await gradingService.getAttemptForGrading(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function gradeWriting(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as GradeWritingBody;
  const result = await gradingService.gradeWriting(body, user.id, user.role);
  sendSuccess(res, result, 201);
}
