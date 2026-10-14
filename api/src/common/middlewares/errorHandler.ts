import type { ErrorRequestHandler } from "express";
import { AppError, BadRequestError } from "../errors/AppError.js";
import { logger } from "../utils/logger.js";
import { sendError } from "../utils/response.util.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err);
    return;
  }

  if (err?.name === "CastError" || err?.name === "BSONError") {
    sendError(res, new BadRequestError("VALIDATION_ERROR", "Định dạng ID không hợp lệ."));
    return;
  }

  if (err?.name === "ValidationError") {
    const details =
      err?.errors && typeof err.errors === "object"
        ? Object.entries(err.errors as Record<string, { message?: string }>).map(
            ([path, issue]) => ({ path, message: issue?.message ?? "Dữ liệu không hợp lệ." })
          )
        : undefined;
    sendError(
      res,
      new BadRequestError("VALIDATION_ERROR", err.message || "Dữ liệu không hợp lệ.", details)
    );
    return;
  }

  logger.error("request.error", {
    name: err?.name ?? "Error",
    message: err?.message ?? "Unknown error",
  });
  sendError(res, new AppError(500, "INTERNAL_SERVER_ERROR", "Lỗi máy chủ không mong muốn."));
};
