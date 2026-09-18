import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as mediaService from "./media.service.js";
import type { ListMediaQuery, PresignUploadBody } from "./media.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function presignUpload(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as PresignUploadBody;
  const result = await mediaService.createPresignedUpload(body, user.id);
  sendSuccess(res, result);
}

export async function confirmUpload(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await mediaService.confirmUpload(id, user.id);
  sendSuccess(res, result);
}

export async function listMedia(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as ListMediaQuery;
  const result = await mediaService.listMedia(user.id, user.role, query);
  sendSuccess(res, result.items, 200, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
  });
}

export async function deleteMedia(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  await mediaService.deleteMedia(id, user.id, user.role);
  sendSuccess(res, { message: "Xóa media thành công" });
}
