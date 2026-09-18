import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as attemptService from "./attempt.service.js";
import type { AutosaveAnswersBody, StartAttemptBody } from "./attempt.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function start(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { examId, assignmentId } = req.body as StartAttemptBody;
  const result = await attemptService.startAttempt(user.id, examId, assignmentId);
  sendSuccess(res, result, 201);
}

export async function getAttempt(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await attemptService.getAttemptForRecovery(id, user.id);
  sendSuccess(res, result);
}

export async function autosave(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const { answers } = req.body as AutosaveAnswersBody;
  const result = await attemptService.autosaveAnswers(id, user.id, answers);
  sendSuccess(res, result);
}

export async function submit(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await attemptService.submitAttempt(id, user.id);
  sendSuccess(res, result);
}

export async function getResult(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await attemptService.getAttemptResult(id, user.id);
  sendSuccess(res, result);
}
