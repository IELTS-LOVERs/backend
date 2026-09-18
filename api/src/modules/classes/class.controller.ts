import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as classService from "./class.service.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function getClasses(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const classes = await classService.getClassesByUser(user.id, user.role);
  sendSuccess(res, classes);
}

export async function createClass(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const cls = await classService.createClass(user.id, req.body);
  sendSuccess(res, cls, 201);
}

export async function getClassDetail(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const classId = req.params.id as string;
  const cls = await classService.getClassDetail(classId, user.id, user.role);
  sendSuccess(res, cls);
}

export async function joinClass(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await classService.joinClass(user.id, req.body.code);
  sendSuccess(res, result);
}

export async function addStudent(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const classId = req.params.id as string;
  const result = await classService.addStudentByEmail(classId, user.id, user.role, req.body.email);
  sendSuccess(res, result);
}

export async function removeStudent(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const classId = req.params.id as string;
  const studentId = req.params.studentId as string;
  const result = await classService.removeStudent(classId, user.id, user.role, studentId);
  sendSuccess(res, result);
}
