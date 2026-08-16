import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const prisma = await getDb();
import { signMockPayload } from "@/lib/payment/providers/mock";
import type { RawWebhook } from "@/lib/payment/types";
import { handlePaymentWebhook, WebhookSignatureError } from "@/server/payment/webhook";

async function createTestOrder(totalAmount: number) {
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
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

function createTestPayment(orderId: string, amount: number, providerRef: string) {
  return prisma.payment.create({
    data: { orderId, provider: "mock", providerRef, status: "PENDING", amount, idempotencyKey: randomUUID() },
  });
}

function buildRaw(payload: unknown, signatureOverride?: string): RawWebhook {
  const rawBody = JSON.stringify(payload);
  return {
    headers: { "x-mock-signature": signatureOverride ?? signMockPayload(rawBody) },
    rawBody,
    query: {},
  };
}

let testOrderIds: string[] = [];
let testProviderEventIds: string[] = [];

afterEach(async () => {
  await prisma.paymentEvent.deleteMany({ where: { providerEventId: { in: testProviderEventIds } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
  testOrderIds = [];
  testProviderEventIds = [];
});

describe("handlePaymentWebhook", () => {
  it("rejects an invalid signature and leaves the order untouched", async () => {
    const order = await createTestOrder(100);
    testOrderIds.push(order.id);

    const payload = {
      providerEventId: randomUUID(),
      paymentId: randomUUID(),
      orderNo: order.orderNo,
      amount: order.totalAmount,
      currency: "TWD",
      eventType: "charge.succeeded",
      paidAt: new Date().toISOString(),
    };
    testProviderEventIds.push(payload.providerEventId);
    const raw = buildRaw(payload, "0".repeat(64));

    await expect(handlePaymentWebhook("mock", raw)).rejects.toThrow(WebhookSignatureError);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("PENDING_PAYMENT");
    const events = await prisma.paymentEvent.findMany({ where: { providerEventId: payload.providerEventId } });
    expect(events).toHaveLength(0);
  });

  it("processes a successful charge: transitions to PAID and assigns a pickup number", async () => {
    const order = await createTestOrder(150);
    testOrderIds.push(order.id);
    const providerRef = randomUUID();
    await createTestPayment(order.id, 150, providerRef);

    const payload = {
      providerEventId: randomUUID(),
      paymentId: providerRef,
      orderNo: order.orderNo,
      amount: 150,
      currency: "TWD",
      eventType: "charge.succeeded",
      paidAt: new Date().toISOString(),
    };
    testProviderEventIds.push(payload.providerEventId);

    const outcome = await handlePaymentWebhook("mock", buildRaw(payload));
    expect(outcome).toBe("PROCESSED");

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("PAID");
    expect(reloaded.pickupNumber).not.toBeNull();
    expect(reloaded.paidAt).not.toBeNull();

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe("SUCCEEDED");

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0].toStatus).toBe("PAID");
  });

  it("is idempotent for a duplicate providerEventId (webhook resend)", async () => {
    const order = await createTestOrder(100);
    testOrderIds.push(order.id);
    const providerRef = randomUUID();
    await createTestPayment(order.id, 100, providerRef);

    const payload = {
      providerEventId: randomUUID(),
      paymentId: providerRef,
      orderNo: order.orderNo,
      amount: 100,
      currency: "TWD",
      eventType: "charge.succeeded",
      paidAt: new Date().toISOString(),
    };
    testProviderEventIds.push(payload.providerEventId);
    const raw = buildRaw(payload);

    const first = await handlePaymentWebhook("mock", raw);
    const second = await handlePaymentWebhook("mock", raw);

    expect(first).toBe("PROCESSED");
    expect(second).toBe("DUPLICATE");

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1); // 沒有因重送而重複轉移

    const paymentEvents = await prisma.paymentEvent.findMany({
      where: { provider: "mock", providerEventId: payload.providerEventId },
    });
    expect(paymentEvents).toHaveLength(1);
  });

  it("does not transition the order when the webhook amount mismatches", async () => {
    const order = await createTestOrder(200);
    testOrderIds.push(order.id);
    const providerRef = randomUUID();
    await createTestPayment(order.id, 200, providerRef);

    const payload = {
      providerEventId: randomUUID(),
      paymentId: providerRef,
      orderNo: order.orderNo,
      amount: 999, // 與 order.totalAmount 不符
      currency: "TWD",
      eventType: "charge.succeeded",
      paidAt: new Date().toISOString(),
    };
    testProviderEventIds.push(payload.providerEventId);

    const outcome = await handlePaymentWebhook("mock", buildRaw(payload));
    expect(outcome).toBe("AMOUNT_MISMATCH");

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe("PENDING_PAYMENT");
    expect(reloaded.pickupNumber).toBeNull();

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.failureCode).toBe("AMOUNT_MISMATCH");
  });
});
