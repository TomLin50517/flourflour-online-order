import { NextResponse } from "next/server";
import { ZodError } from "zod";

// 見 SPEC.md §8.1 錯誤碼列表
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "PRODUCT_UNAVAILABLE",
  "INVALID_OPTION_SELECTION",
  "AMOUNT_MISMATCH",
  "INVALID_STATE_TRANSITION",
  "ORDER_EXPIRED",
  "PAYMENT_PROVIDER_NOT_CONFIGURED",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PRODUCT_UNAVAILABLE: 409,
  INVALID_OPTION_SELECTION: 422,
  AMOUNT_MISMATCH: 409,
  INVALID_STATE_TRANSITION: 409,
  ORDER_EXPIRED: 410,
  PAYMENT_PROVIDER_NOT_CONFIGURED: 503,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: unknown) {
    super("NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION_FAILED", message, details);
    this.name = "ValidationError";
  }
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details ?? {} } },
      { status: STATUS_BY_CODE[error.code] },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED" satisfies ErrorCode,
          message: "Validation failed",
          details: error.flatten(),
        },
      },
      { status: STATUS_BY_CODE.VALIDATION_FAILED },
    );
  }

  if (error instanceof NotImplementedError) {
    return NextResponse.json(
      {
        error: {
          code: "PAYMENT_PROVIDER_NOT_CONFIGURED" satisfies ErrorCode,
          message: error.message,
          details: {},
        },
      },
      { status: STATUS_BY_CODE.PAYMENT_PROVIDER_NOT_CONFIGURED },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR" satisfies ErrorCode, message: "系統忙碌，請稍後再試", details: {} } },
    { status: STATUS_BY_CODE.INTERNAL_ERROR },
  );
}
