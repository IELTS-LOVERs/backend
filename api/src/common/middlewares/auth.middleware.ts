import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../errors/AppError.js";

export interface AccessTokenPayload {
  sub: string;
  role: string;
  email: string;
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    next(
      new UnauthorizedError(
        "UNAUTHORIZED",
        "Token không hợp lệ hoặc thiếu Authorization Header."
      )
    );
    return;
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError("TOKEN_EXPIRED", "Access Token đã hết hạn."));
      return;
    }

    next(new UnauthorizedError("UNAUTHORIZED", "Token không hợp lệ."));
  }
}
