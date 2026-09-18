export type StandardErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "OLD_PASSWORD_INCORRECT"
  | "CLASS_CODE_INVALID"
  | "STUDENT_ALREADY_IN_CLASS"
  | "STUDENT_NOT_IN_CLASS"
  | "EXAM_ALREADY_SUBMITTED"
  | "EXAM_NOT_PUBLISHED"
  | "EXAM_CANNOT_EDIT_PUBLISHED"
  | "EXAM_NOT_SUBMITTED"
  | "ASSIGNMENT_DEADLINE_PASSED"
  | "MEDIA_NOT_UPLOADED"
  | "UNAUTHORIZED"
  | "TOKEN_EXPIRED"
  | "REFRESH_TOKEN_INVALID"
  | "FORBIDDEN"
  | "ATTEMPT_NOT_OWNED"
  | "EXAM_EXPIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR";

export type ErrorCode = StandardErrorCode | (string & {});

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, errorCode: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(errorCode: string, message: string, details?: unknown) {
    super(400, errorCode, message, details);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(errorCode: string, message: string, details?: unknown) {
    super(401, errorCode, message, details);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(errorCode: string, message: string, details?: unknown) {
    super(403, errorCode, message, details);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Tài nguyên yêu cầu không tồn tại.") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(errorCode: string, message: string, details?: unknown) {
    super(409, errorCode, message, details);
    this.name = "ConflictError";
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Vượt quá giới hạn gọi API.") {
    super(429, "TOO_MANY_REQUESTS", message);
    this.name = "TooManyRequestsError";
  }
}
