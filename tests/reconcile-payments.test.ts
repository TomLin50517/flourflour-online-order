import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { orThrow } from "@/db/helpers";
import {
  order as orderTable,
  orderEvent as orderEventTable,
  payment as paymentTable,
} from "@/db/schema";
import { getDb } from "@/db/client";

const db = await getDb();
import { reconcilePendingPayments } from "@/server/payment/reconcile";

async function createStaleOrder(totalAmount: number) {
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
      subtotalAmount: totalAmount,
      totalAmount,
      placedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 分鐘前下單，超過 3 分鐘門檻
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning();
  return orThrow(row);
}

let testOrderIds: string[] = [];

afterEach(async () => {
  if (testOrderIds.length > 0) {
    await db.delete(orderEventTable).where(inArray(orderEventTable.orderId, testOrderIds));
    await db.delete(paymentTable).where(inArray(paymentTable.orderId, testOrderIds));
    await db.delete(orderTable).where(inArray(orderTable.id, testOrderIds));
  }
  testOrderIds = [];
});

describe("reconcilePendingPayments", () => {
  it("confirms a PENDING_PAYMENT order whose mock charge already succeeded", async () => {
    const order = await createStaleOrder(120);
    testOrderIds.push(order.id);

    // MockProvider.queryCharge 直接讀自家 Payment 表，故先把 Payment 標成 SUCCEEDED
    // 模擬「webhook 遺失，但廠商那邊其實已經扣款成功」的情境。
    await db.insert(paymentTable).values({
      orderId: order.id,
      provider: "mock",
      providerRef: randomUUID(),
      status: "SUCCEEDED",
      amount: 120,
      idempotencyKey: randomUUID(),
      paidAt: new Date(),
    });

    const result = await reconcilePendingPayments(new Date());
    expect(result.reconciled).toBeGreaterThanOrEqual(1);

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("PAID");
    expect(reloaded.pickupNumber).not.toBeNull();
  });

  it("leaves the order untouched when the provider still reports PENDING", async () => {
    const order = await createStaleOrder(80);
    testOrderIds.push(order.id);

    await db.insert(paymentTable).values({
      orderId: order.id,
      provider: "mock",
      providerRef: randomUUID(),
      status: "PENDING",
      amount: 80,
      idempotencyKey: randomUUID(),
    });

    await reconcilePendingPayments(new Date());

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("PENDING_PAYMENT");
  });
});
