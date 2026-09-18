import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as questionService from "./question.service.js";
import type { ListQuestionsQuery } from "./question.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function createQuestion(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const question = await questionService.create(req.body, user.id);
  sendSuccess(res, question, 201);
}

export async function listQuestions(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListQuestionsQuery;
  const { questions, page, limit, total, totalPages } = await questionService.list(query);
  sendSuccess(res, questions, 200, { page, limit, total, totalPages });
}

export async function getQuestion(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const question = await questionService.getById(id);
  sendSuccess(res, question);
}

export async function updateQuestion(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  await questionService.update(id, req.body, user.id, user.role);
  sendSuccess(res, { id, message: "Cập nhật câu hỏi thành công" });
}

export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  await questionService.remove(id, user.id, user.role);
  sendSuccess(res, { message: "Xóa câu hỏi thành công" });
}
