import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const prisma = await getDb();
import { expireOverdueOrders } from "@/server/order/expire-orders";

// 見 tests/payment-webhook.test.ts 的說明：Vitest 預設會平行跑多個測試檔，
// 若沿用 state-machine.test.ts 的 "TEST-" 前綴＋依前綴清理的寫法，會被其他檔案
// 同時進行的清理查詢誤刪。這裡改用專屬前綴＋依實際建立的 id 清理，避免互相干擾。
async function createOrder(expiresAt: Date) {
  const store = await prisma.store.findFirstOrThrow();
  return prisma.order.create({
    data: {
      storeId: store.id,
      orderNo: `M4TEST-${randomUUID()}`,
      accessToken: randomUUID(),
      idempotencyKey: randomUUID(),
      status: "PENDING_PAYMENT",
      locale: "ZH_TW",
      subtotalAmount: 100,
      totalAmount: 100,
      expiresAt,
    },
  });
}

let testOrderIds: string[] = [];

afterEach(async () => {
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
  testOrderIds = [];
});

describe("expireOverdueOrders", () => {
  it("cancels PENDING_PAYMENT orders past expiresAt", async () => {
    const order = await createOrder(new Date(Date.now() - 60 * 1000));
    testOrderIds.push(order.id);

    const result = await expireOverdueOrders(new Date());
    expect(result.cancelled).toBeGreaterThanOrEqual(1);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.cancelledAt).not.toBeNull();

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ toStatus: "CANCELLED", actorType: "SYSTEM" });
  });

  it("does not touch orders that are not yet expired", async () => {
    const order = await createOrder(new Date(Date.now() + 60 * 1000));
    testOrderIds.push(order.id);

    await expireOverdueOrders(new Date());

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("PENDING_PAYMENT");
  });
});
