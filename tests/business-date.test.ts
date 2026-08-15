import { describe, expect, it } from "vitest";
import { formatBusinessDateCompact, toBusinessDate } from "@/server/order/business-date";

const TZ = "Asia/Taipei";
const CUTOFF = "04:00";

describe("toBusinessDate", () => {
  it("keeps the same calendar day when local time is after cutoff", () => {
    // 2026-08-15 10:00 Asia/Taipei = 2026-08-15 02:00 UTC
    const at = new Date("2026-08-15T02:00:00Z");
    const result = toBusinessDate(at, TZ, CUTOFF);
    expect(formatBusinessDateCompact(result)).toBe("20260815");
  });

  it("rolls back to the previous day when local time is before cutoff", () => {
    // 2026-08-16 02:00 Asia/Taipei = 2026-08-15 18:00 UTC
    const at = new Date("2026-08-15T18:00:00Z");
    const result = toBusinessDate(at, TZ, CUTOFF);
    expect(formatBusinessDateCompact(result)).toBe("20260815");
  });

  it("treats local time exactly at cutoff as the new day", () => {
    // 2026-08-16 04:00 Asia/Taipei = 2026-08-15 20:00 UTC
    const at = new Date("2026-08-15T20:00:00Z");
    const result = toBusinessDate(at, TZ, CUTOFF);
    expect(formatBusinessDateCompact(result)).toBe("20260816");
  });
});
