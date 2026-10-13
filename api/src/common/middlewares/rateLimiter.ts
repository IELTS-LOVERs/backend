import type { RequestHandler } from "express";

export function createRateLimiter(_maxRequests?: number, _windowMs?: number): RequestHandler {
  return (_req, _res, next) => next();
}
