/**
 * 見 SPEC.md §6.3：將 UTC 時間轉為門市時區後，若本地時間 < businessDayCutoff（HH:mm），
 * 營業日視為前一天。回傳 UTC 午夜的 Date，供 Prisma @db.Date 欄位使用。
 */
export function toBusinessDate(at: Date, timezone: string, cutoff: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  const [cutoffHour, cutoffMinute] = cutoff.split(":").map(Number);
  const localMinutes = hour * 60 + minute;
  const cutoffMinutes = cutoffHour * 60 + cutoffMinute;

  const businessDateMs = Date.UTC(year, month - 1, day);
  const isBeforeCutoff = localMinutes < cutoffMinutes;
  return new Date(isBeforeCutoff ? businessDateMs - 24 * 60 * 60 * 1000 : businessDateMs);
}

export function formatBusinessDateCompact(businessDate: Date): string {
  const year = businessDate.getUTCFullYear();
  const month = String(businessDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(businessDate.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
