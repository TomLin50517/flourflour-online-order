/**
 * 將 "YYYY-MM-DD" 轉為對應的 UTC 午夜 Date，與 `businessDate` 欄位（`@db.Date`）
 * 的儲存慣例一致（見 server/order/business-date.ts 的 `toBusinessDate`）。
 */
export function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`日期格式錯誤，需為 YYYY-MM-DD：${value}`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
