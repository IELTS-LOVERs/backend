import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import { AppError } from "../errors/AppError.js";

export interface RateLimiterOptions {
  /**
   * I-4: count only FAILED responses toward the limit (successful requests are
   * decremented on response finish). Used for login/register so a classroom
   * behind one NAT IP is not blocked when many students log in successfully,
   * while brute-force attempts still get limited.
   */
  skipSuccessfulRequests?: boolean;
}

/**
 * Builds a real rate-limiting middleware backed by express-rate-limit.
 *
 * The 429 is raised as an AppError so the shared error handler keeps the
 * standard `{ success:false, error:{ code, message } }` envelope. The frontend
 * login page keys off `error.code === "TOO_MANY_REQUESTS"`.
 */
export function createRateLimiter(
  maxRequests = 100,
  windowMs = 60_000,
  options: RateLimiterOptions = {}
): RequestHandler {
  return rateLimit({
    windowMs,
    limit: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          "TOO_MANY_REQUESTS",
          "Quá nhiều yêu cầu. Vui lòng thử lại sau."
        )
      );
    },
  });
}
