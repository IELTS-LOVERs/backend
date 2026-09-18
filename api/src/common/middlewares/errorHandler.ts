import type { ErrorRequestHandler } from "express";
import { AppError, BadRequestError } from "../errors/AppError.js";
import { sendError } from "../utils/response.util.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err);
    return;
  }

  if (err?.name === "CastError") {
    sendError(res, new BadRequestError("VALIDATION_ERROR", "Định dạng ID không hợp lệ."));
    return;
  }

  console.error("[error]", err);
  sendError(res, new AppError(500, "INTERNAL_SERVER_ERROR", "Lỗi máy chủ không mong muốn."));
};
