import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../errors/AppError.js";
import { UserModel } from "../../modules/users/user.model.js";

export interface AccessTokenPayload {
  sub: string;
  role: string;
  email: string;
  tokenVersion?: number;
  type?: "access";
}

/**
 * FIX-05: authenticates the bearer access token AND checks the live user state,
 * so a suspended account or a bumped `tokenVersion` (password change / admin
 * reset / replay detection) immediately invalidates outstanding access tokens.
 * The role is taken from the database, not the token, so role changes apply at
 * once. FIX-20: tokens carry a `type` discriminator (legacy tokens without one
 * are still accepted during the transition; wrong types are rejected).
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
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

  let payload: AccessTokenPayload;

  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError("TOKEN_EXPIRED", "Access Token đã hết hạn."));
      return;
    }

    next(new UnauthorizedError("UNAUTHORIZED", "Token không hợp lệ."));
    return;
  }

  // FIX-20: reject non-access tokens (tolerant of legacy tokens lacking `type`).
  if (payload.type && payload.type !== "access") {
    next(new UnauthorizedError("UNAUTHORIZED", "Token không hợp lệ."));
    return;
  }

  try {
    const user = await UserModel.findById(payload.sub).select(
      "status tokenVersion role email"
    );

    if (!user || user.status === "suspended") {
      next(new UnauthorizedError("UNAUTHORIZED", "Tài khoản không khả dụng."));
      return;
    }

    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      next(new UnauthorizedError("TOKEN_REVOKED", "Phiên đăng nhập đã bị thu hồi."));
      return;
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
    };
    next();
  } catch (error) {
    next(error);
  }
}
