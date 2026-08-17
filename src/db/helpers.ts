// 見 docs/DRIZZLE-MIGRATION-SPEC.md §4.8：Drizzle 沒有 Prisma `findFirstOrThrow`／
// `findUniqueOrThrow` 的等價物，統一用這個 helper 包裝。這些呼叫點原本大多是查詢
// Store 這種「應用層視為必定存在」的設定列，找不到代表嚴重的環境設定錯誤（例如
// 資料庫沒跑過 seed），不是一般使用者可能觸發的業務情境，故不特化成
// `NotFoundError`（i18n key）——維持原本 Prisma 的行為：讓它成為一個未預期錯誤，
// 由 `lib/errors.ts` 的全域錯誤處理器兜底為 500。
export class RecordNotFoundError extends Error {
  constructor(message = "Record not found") {
    super(message);
    this.name = "RecordNotFoundError";
  }
}

export function orThrow<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new RecordNotFoundError();
  }
  return value;
}

// Postgres unique_violation 的 SQLSTATE 是 "23505"（Prisma 的等價物是 P2002）。
// Drizzle 把底層 pg 的錯誤包在 DrizzleQueryError 的 `.cause` 裡（見
// node_modules/drizzle-orm/errors.js），不像 Prisma 直接把 code 放在最外層，
// 故要往 `.cause` 遞迴找，不能只看最外層的 error.code。
function extractPgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if ("cause" in error) {
    return extractPgErrorCode((error as { cause?: unknown }).cause);
  }
  return undefined;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return extractPgErrorCode(error) === "23505";
}
