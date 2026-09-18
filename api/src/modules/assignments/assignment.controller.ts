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

export async function getAssignment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const assignment = await assignmentService.getAssignmentById(id, user.id, user.role);
  sendSuccess(res, assignment);
}

export async function updateAssignment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const assignment = await assignmentService.updateAssignment(id, user.id, user.role, req.body);
  sendSuccess(res, assignment);
}

export async function deleteAssignment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await assignmentService.deleteAssignment(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function getAssignmentProgress(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await assignmentService.getAssignmentProgress(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function exportAssignmentReport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const csv = await assignmentService.exportAssignmentCsv(id, user.id, user.role);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="assignment-${id}.csv"`);
  res.status(200).send(`\uFEFF${csv}`);
}
