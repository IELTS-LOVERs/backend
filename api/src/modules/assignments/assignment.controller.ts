import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as assignmentService from "./assignment.service.js";
import type { ListAssignmentsQuery } from "./assignment.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function createAssignment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const assignment = await assignmentService.create(req.body, user.id, user.role);
  sendSuccess(res, assignment, 201);
}

export async function getMyAssignments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const assignments = await assignmentService.getMyAssignments(user.id);
  sendSuccess(res, assignments);
}

export async function getAssignments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as ListAssignmentsQuery;
  const { assignments, meta } = await assignmentService.getAssignmentsForTeacher(
    user.id,
    user.role,
    {
      classId: query.classId,
      page: query.page,
      limit: query.limit,
    }
  );
  sendSuccess(res, assignments, 200, meta);
}

export async function getAssignmentProgress(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await assignmentService.getAssignmentProgress(id, user.id, user.role);
  sendSuccess(res, result);
}
