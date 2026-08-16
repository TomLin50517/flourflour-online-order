// 見 SPEC.md INV-8：Payment.rawRequest/rawResponse 寫入前須經 maskSensitive() 過濾卡號、CVV、Token。
const SENSITIVE_KEY_PATTERN = /card.?number|cvv|cvc|cvc2|security.?code|password|secret|token|hash.?key|hash.?iv/i;
const REDACTED = "[REDACTED]";

/**
 * 遞迴遮蔽物件中鍵名符合敏感樣式的值。陣列與巢狀物件皆會遞迴處理，
 * 其餘型別（string/number/boolean/null）原樣保留。
 */
export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitive(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : maskSensitive(val);
    }
    return result;
  }
  return value;
}
