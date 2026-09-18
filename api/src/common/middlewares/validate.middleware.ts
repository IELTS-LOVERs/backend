import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BadRequestError } from "../errors/AppError.js";

export function validate(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      next(
        new BadRequestError(
          "VALIDATION_ERROR",
          "Dữ liệu đầu vào không hợp lệ.",
          result.error.issues
        )
      );
      return;
    }

    const data = result.data as {
      body?: unknown;
      params?: unknown;
      query?: unknown;
    };

    if (data.body !== undefined) req.body = data.body;
    if (data.params !== undefined) req.params = data.params as Request["params"];
    if (data.query !== undefined) {
      // Express 5 defines req.query with a getter, so assign via defineProperty.
      Object.defineProperty(req, "query", {
        value: data.query,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    next();
  };
}
