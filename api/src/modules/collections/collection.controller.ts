import type { Request, Response } from "express";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { sendSuccess } from "../../common/utils/response.util.js";
import * as collectionService from "./collection.service.js";
import type {
  AddExamsToCollectionBody,
  CreateCollectionBody,
  ListCollectionsQuery,
  ReorderExamsInCollectionBody,
  UpdateCollectionBody,
  UpdateExamInCollectionBody,
} from "./collection.validation.js";

function requireUser(req: Request): NonNullable<Request["user"]> {
  if (!req.user) {
    throw new UnauthorizedError(
      "UNAUTHORIZED",
      "Token không hợp lệ hoặc thiếu Authorization Header."
    );
  }
  return req.user;
}

export async function listCollections(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = req.query as unknown as ListCollectionsQuery;
  const { collections, page, limit, total, totalPages } =
    await collectionService.listCollections(user.id, user.role, query);
  sendSuccess(res, collections, 200, { page, limit, total, totalPages });
}

export async function getCollectionTree(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const tree = await collectionService.getCollectionTree();
  sendSuccess(res, tree);
}

export async function getCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const data = await collectionService.getCollectionDetail(id, user.id, user.role);
  sendSuccess(res, data);
}

export async function createCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as CreateCollectionBody;
  const collection = await collectionService.createCollection(body, user.id);
  sendSuccess(res, collection, 201);
}

export async function updateCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const body = req.body as UpdateCollectionBody;
  const collection = await collectionService.updateCollection(id, body, user.id, user.role);
  sendSuccess(res, collection);
}

export async function deleteCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const result = await collectionService.deleteCollection(id, user.id, user.role);
  sendSuccess(res, result);
}

export async function addExamsToCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const body = req.body as AddExamsToCollectionBody;
  const result = await collectionService.addExamsToCollection(id, body, user.id, user.role);
  sendSuccess(res, result);
}

export async function removeExamFromCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const examId = req.params.examId as string;
  const result = await collectionService.removeExamFromCollection(id, examId, user.id, user.role);
  sendSuccess(res, result);
}

export async function updateExamInCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const examId = req.params.examId as string;
  const body = req.body as UpdateExamInCollectionBody;
  const result = await collectionService.updateExamInCollection(id, examId, body, user.id, user.role);
  sendSuccess(res, result);
}

export async function reorderExamsInCollection(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = req.params.id as string;
  const body = req.body as ReorderExamsInCollectionBody;
  const result = await collectionService.reorderExamsInCollection(id, body, user.id, user.role);
  sendSuccess(res, result);
}
