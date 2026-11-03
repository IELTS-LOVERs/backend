import { requireUser } from "../../common/middlewares/auth.middleware.js";
import type { Request, Response } from "express";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as antiCheatService from "./anti-cheat.service.js";
import type {
  LogExamEventBody,
  SuspiciousReportQuery,
} from "./anti-cheat.validation.js";


export async function logEvent(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as LogExamEventBody;
  const result = await antiCheatService.logEvent(body, user.id);
  sendSuccess(res, result);
}

export async function getEvents(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const attemptId = (req.params.attemptId ?? req.params.id) as string;
  const result = await antiCheatService.getAttemptEvents(attemptId, user);
  sendSuccess(res, result);
}

export async function getSuspiciousReport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as SuspiciousReportQuery;
  const result = await antiCheatService.getSuspiciousAttempts(
    user.id,
    user.role,
    query.limit
  );
  sendSuccess(res, result.items, 200, { total: result.total });
}

