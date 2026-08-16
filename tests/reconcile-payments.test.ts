import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const prisma = await getDb();
import { reconcilePendingPayments } from "@/server/payment/reconcile";

async function createStaleOrder(totalAmount: number) {
  const store = await prisma.store.findFirstOrThrow();
  return prisma.order.create({
    data: {
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
    },
  });
}

let testOrderIds: string[] = [];

afterEach(async () => {
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
  testOrderIds = [];
});

describe("reconcilePendingPayments", () => {
  it("confirms a PENDING_PAYMENT order whose mock charge already succeeded", async () => {
    const order = await createStaleOrder(120);
    testOrderIds.push(order.id);

    // MockProvider.queryCharge 直接讀自家 Payment 表，故先把 Payment 標成 SUCCEEDED
    // 模擬「webhook 遺失，但廠商那邊其實已經扣款成功」的情境。
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        providerRef: randomUUID(),
        status: "SUCCEEDED",
        amount: 120,
        idempotencyKey: randomUUID(),
        paidAt: new Date(),
      },
    });

    const result = await reconcilePendingPayments(new Date());
    expect(result.reconciled).toBeGreaterThanOrEqual(1);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("PAID");
    expect(reloaded.pickupNumber).not.toBeNull();
  });

  it("leaves the order untouched when the provider still reports PENDING", async () => {
    const order = await createStaleOrder(80);
    testOrderIds.push(order.id);

    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        providerRef: randomUUID(),
        status: "PENDING",
        amount: 80,
        idempotencyKey: randomUUID(),
      },
    });

    await reconcilePendingPayments(new Date());

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("PENDING_PAYMENT");
  });
});
