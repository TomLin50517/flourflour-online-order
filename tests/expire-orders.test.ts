import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { orThrow } from "@/db/helpers";
import { order as orderTable, orderEvent as orderEventTable } from "@/db/schema";
import { getDb } from "@/db/client";

const db = await getDb();
import { expireOverdueOrders } from "@/server/order/expire-orders";

// 見 tests/payment-webhook.test.ts 的說明：Vitest 預設會平行跑多個測試檔，
// 若沿用 state-machine.test.ts 的 "TEST-" 前綴＋依前綴清理的寫法，會被其他檔案
// 同時進行的清理查詢誤刪。這裡改用專屬前綴＋依實際建立的 id 清理，避免互相干擾。
async function createOrder(expiresAt: Date) {
  const store = orThrow(await db.query.store.findFirst());
  const [row] = await db
    .insert(orderTable)
    .values({
      storeId: store.id,
      orderNo: `M4TEST-${randomUUID()}`,
      accessToken: randomUUID(),
      idempotencyKey: randomUUID(),
      status: "PENDING_PAYMENT",
      locale: "ZH_TW",
      subtotalAmount: 100,
      totalAmount: 100,
      expiresAt,
    })
    .returning();
  return orThrow(row);
}

let testOrderIds: string[] = [];

afterEach(async () => {
  if (testOrderIds.length > 0) {
    await db.delete(orderEventTable).where(inArray(orderEventTable.orderId, testOrderIds));
    await db.delete(orderTable).where(inArray(orderTable.id, testOrderIds));
  }
  testOrderIds = [];
});

describe("expireOverdueOrders", () => {
  it("cancels PENDING_PAYMENT orders past expiresAt", async () => {
    const order = await createOrder(new Date(Date.now() - 60 * 1000));
    testOrderIds.push(order.id);

    const result = await expireOverdueOrders(new Date());
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.cancelledAt).not.toBeNull();

    const events = await db.query.orderEvent.findMany({ where: eq(orderEventTable.orderId, order.id) });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ toStatus: "CANCELLED", actorType: "SYSTEM" });
  });

  it("does not touch orders that are not yet expired", async () => {
    const order = await createOrder(new Date(Date.now() + 60 * 1000));
    testOrderIds.push(order.id);

    await expireOverdueOrders(new Date());

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("PENDING_PAYMENT");
  });
});
