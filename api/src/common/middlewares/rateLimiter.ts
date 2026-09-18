import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

export function createRateLimiter(maxRequests: number, windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit: maxRequests,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Vượt quá giới hạn gọi API.",
          details: null,
        },
      });
    },
  });
}
