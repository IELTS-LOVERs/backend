import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../errors/AppError.js";

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(
        new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.")
      );
      return;
    }

    next();
  };
}
