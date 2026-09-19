import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

export function createRateLimiter(_maxRequests?: number, _windowMs?: number): RequestHandler {
  return (_req, _res, next) => next();
}
