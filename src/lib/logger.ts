// 見 SPEC.md §12.3：結構化日誌含 requestId；§12.1：日誌需以 maskSensitive() 過濾
// 卡號、token、accessToken、phone（僅留後 3 碼）。這裡的遮蔽邏輯是給「一般結構化
// 日誌」用的（含 phone 部分遮蔽的規則），跟 lib/payment/mask.ts 的 maskSensitive()
// 是分開的——後者專門用於 Payment.rawRequest/rawResponse 這種只需要「全遮蔽」的
// 廠商原始資料快照，兩者遮蔽規則不完全一樣，故不共用同一個函式。

type LogLevel = "info" | "warn" | "error" | "alert";
type LogFields = Record<string, unknown>;

const FULL_REDACT_KEY = /card.?number|cvv|cvc|security.?code|password|secret|token|hash.?key|hash.?iv/i;
const PHONE_KEY = /phone/i;

function maskPhone(value: string): string {
  return value.length <= 3 ? value : `***${value.slice(-3)}`;
}

function maskValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (FULL_REDACT_KEY.test(key)) return "[REDACTED]";
    if (PHONE_KEY.test(key)) return maskPhone(value);
    return value;
  }
  return maskFields(value);
}

function maskFields(fields: unknown): unknown {
  if (Array.isArray(fields)) return fields.map((item) => maskFields(item));
  if (fields && typeof fields === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
      result[key] = maskValue(key, value);
    }
    return result;
  }
  return fields;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...(fields ? (maskFields(fields) as LogFields) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "alert") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
  /**
   * 見 SPEC.md §12.3 需要告警的事件：webhook 驗簽失敗、AMOUNT_MISMATCH、
   * 狀態機非法轉移、PENDING_PAYMENT 逾時率 > 20%、NotImplementedError 被觸發。
   * 本專案未串接外部告警通道（Slack/PagerDuty…），先以獨立 log level 呈現，
   * 讓日誌系統可依 level="alert" 設條件式通知（見 docs/OPEN-QUESTIONS.md）。
   */
  alert: (message: string, fields?: LogFields) => emit("alert", message, fields),
};
