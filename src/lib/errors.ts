import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";

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

// 見 SPEC.md §12.3：需要告警的事件之一是「狀態機非法轉移」「AMOUNT_MISMATCH」——
// 兩者都會走到這裡（每個 route handler 的 catch 區塊都呼叫 toErrorResponse），
// 是唯一一個所有錯誤路徑都會經過的地方，故把告警邏輯集中在此，不必逐一改寫
// 三十幾個 route handler。
const ALERT_ON_CODES: ReadonlySet<ErrorCode> = new Set(["AMOUNT_MISMATCH", "INVALID_STATE_TRANSITION"]);

export function toErrorResponse(error: unknown, requestId?: string): NextResponse {
  if (error instanceof AppError) {
    if (ALERT_ON_CODES.has(error.code)) {
      logger.alert(`${error.code}`, { code: error.code, message: error.message, details: error.details, requestId });
    }
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
    // 見 SPEC.md §12.3：NotImplementedError 被觸發是需要告警的事件之一。
    logger.alert("NotImplementedError", { message: error.message, requestId });
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

  logger.error("Unhandled error", {
    requestId,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
  });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR" satisfies ErrorCode, message: "系統忙碌，請稍後再試", details: {} } },
    { status: STATUS_BY_CODE.INTERNAL_ERROR },
  );
}
