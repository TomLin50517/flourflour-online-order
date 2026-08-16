import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const prisma = await getDb();
import { assignPickupNumber, type PickupStoreConfig } from "@/server/order/pickup-number";

function makeStore(overrides: Partial<PickupStoreConfig> = {}): PickupStoreConfig {
  return {
    id: `test-store-${randomUUID()}`,
    timezone: "Asia/Taipei",
    businessDayCutoff: "04:00",
    pickupPrefix: "A",
    pickupPadding: 3,
    pickupMax: 999,
    ...overrides,
  };
}

afterEach(async () => {
  await prisma.pickupCounter.deleteMany({ where: { storeId: { startsWith: "test-store-" } } });
});

describe("assignPickupNumber", () => {
  it("assigns 200 concurrent requests unique, contiguous sequence numbers", async () => {
    const store = makeStore();
    const at = new Date("2026-08-15T02:00:00Z");

    const results = await Promise.all(
      Array.from({ length: 200 }, () => prisma.$transaction((tx) => assignPickupNumber(tx, store, at))),
    );

    const seqs = results.map((r) => r.pickupSeq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(200);
    expect(seqs).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));

    const numbers = new Set(results.map((r) => r.pickupNumber));
    expect(numbers.size).toBe(200);
  });

  it("resets the sequence when the business date changes", async () => {
    const store = makeStore();

    const day1 = await prisma.$transaction((tx) =>
      assignPickupNumber(tx, store, new Date("2026-08-15T02:00:00Z")),
    );
    const day2 = await prisma.$transaction((tx) =>
      assignPickupNumber(tx, store, new Date("2026-08-16T02:00:00Z")),
    );

    expect(day1.pickupSeq).toBe(1);
    expect(day2.pickupSeq).toBe(1);
    expect(day1.businessDate.getTime()).not.toBe(day2.businessDate.getTime());
  });

  it("wraps the prefix once pickupMax is exceeded", async () => {
    const store = makeStore({ pickupMax: 2, pickupPadding: 2 });
    const at = new Date("2026-08-15T02:00:00Z");

    const first = await prisma.$transaction((tx) => assignPickupNumber(tx, store, at));
    const second = await prisma.$transaction((tx) => assignPickupNumber(tx, store, at));
    const third = await prisma.$transaction((tx) => assignPickupNumber(tx, store, at));

    expect(first.pickupNumber).toBe("A01");
    expect(second.pickupNumber).toBe("A02");
    expect(third.pickupNumber).toBe("B01");
  });
});
