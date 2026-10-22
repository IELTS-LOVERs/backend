import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as examService from "./exam.service.js";
import type {
  ListExamsQuery,
  UpdateExamCurriculumBody,
  UpdateExamMetadataBody,
  UpdateExamResourcesBody,
} from "./exam.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function createExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const exam = await examService.create(req.body, user.id);
  sendSuccess(res, exam, 201);
}

export async function listExams(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as ListExamsQuery;
  const { exams, page, limit, total, totalPages } = await examService.list(
    user.id,
    user.role,
    query
  );
  sendSuccess(res, exams, 200, { page, limit, total, totalPages });
}

export async function getExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const exam = await examService.getById(id, user.id, user.role);
  sendSuccess(res, exam);
}

export async function updateExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  await examService.update(id, req.body, user.id, user.role);
  sendSuccess(res, { id, message: "Cập nhật đề thi thành công" });
}

export async function updateExamMetadata(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  await examService.updateMetadata(id, req.body as UpdateExamMetadataBody, user.id, user.role);
  sendSuccess(res, { id, message: "Cập nhật thông tin đề thi thành công" });
}

export async function updateExamResources(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const resources = await examService.updateResources(
    id,
    req.body as UpdateExamResourcesBody,
    user.id,
    user.role
  );
  sendSuccess(res, { id, resources, message: "Cập nhật tài liệu sau nộp thành công" });
}

export async function updateExamCurriculum(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const curriculum = await examService.updateCurriculum(
    id,
    req.body as UpdateExamCurriculumBody,
    user.id,
    user.role
  );
  sendSuccess(res, { id, curriculum, message: "Cập nhật lộ trình thành công" });
}

export async function deleteExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  await examService.remove(id, user.id, user.role);
  sendSuccess(res, { message: "Xóa đề thi thành công" });
}

export async function cloneExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const exam = await examService.clone(id, user.id, user.role);
  sendSuccess(res, exam, 201);
}

export async function publishExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const exam = await examService.publish(id, user.id, user.role);
  sendSuccess(res, exam);
}

export async function unpublishExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await examService.unpublish(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function closeExam(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const exam = await examService.close(id, user.id, user.role);
  sendSuccess(res, exam);
}
