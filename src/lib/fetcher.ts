export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with ${res.status}`);
  }
  return res.json();
}

type ApiErrorBody = {
  error?: {
    message?: string;
    details?: {
      fieldErrors?: Record<string, string[] | undefined>;
      formErrors?: string[];
    };
  };
};

/**
 * 見 CLAUDE.md：後台固定 zh-TW、不做 i18n，故這裡直接組中文訊息。
 * `toErrorResponse()`（lib/errors.ts）對 ZodError 一律回傳通用的
 * "Validation failed"，實際哪個欄位、為什麼失敗只在 `details.fieldErrors`
 * 裡——後台表單只顯示了最外層的通用訊息，等於完全看不出問題在哪。
 * 這裡優先組出逐欄位的訊息，只有在沒有欄位級細節時才退回通用訊息。
 */
export function formatApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object" || !("error" in body)) return fallback;
  const error = (body as ApiErrorBody).error;
  if (!error) return fallback;

  const fieldErrors = error.details?.fieldErrors;
  if (fieldErrors) {
    const parts = Object.entries(fieldErrors)
      .filter((entry): entry is [string, string[]] => Boolean(entry[1]?.length))
      .map(([field, messages]) => `${field}：${messages.join("、")}`);
    if (parts.length > 0) return parts.join("；");
  }

  return error.message ?? fallback;
}
