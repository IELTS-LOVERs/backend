import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as antiCheatService from "./anti-cheat.service.js";
import type { LogExamEventBody } from "./anti-cheat.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function logEvent(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as LogExamEventBody;
  const result = await antiCheatService.logEvent(body, user.id);
  sendSuccess(res, result);
}
