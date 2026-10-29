import type { Response } from "express";
import type { AppError } from "../errors/AppError.js";

export interface ResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  totalPending?: number;
  allCategories?: string[];
  [key: string]: unknown;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: ResponseMeta
): Response<SuccessBody<T>> {
  const body: SuccessBody<T> = { success: true, data };
  if (meta) body.meta = meta;

  return res.status(statusCode).json(body);
}

export function sendError(res: Response, error: AppError): Response<ErrorBody> {
  const body: ErrorBody = {
    success: false,
    error: {
      code: error.errorCode,
      message: error.message,
      details: error.details ?? null,
    },
  };

  return res.status(error.statusCode).json(body);
}
