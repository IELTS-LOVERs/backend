import { requireUser } from "../../common/middlewares/auth.middleware.js";
import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as gradingService from "./grading.service.js";
import type { GradeWritingBody } from "./grading.validation.js";


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
