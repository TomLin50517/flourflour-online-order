import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { orThrow } from "@/db/helpers";
import {
  order as orderTable,
  orderEvent as orderEventTable,
  payment as paymentTable,
  paymentEvent as paymentEventTable,
} from "@/db/schema";
import { getDb } from "@/db/client";

const db = await getDb();
import { signMockPayload } from "@/lib/payment/providers/mock";
import type { RawWebhook } from "@/lib/payment/types";
import { handlePaymentWebhook, WebhookSignatureError } from "@/server/payment/webhook";

async function createTestOrder(totalAmount: number) {
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
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    .returning();
  return orThrow(row);
}

async function createTestPayment(orderId: string, amount: number, providerRef: string) {
  const [row] = await db
    .insert(paymentTable)
    .values({ orderId, provider: "mock", providerRef, status: "PENDING", amount, idempotencyKey: randomUUID() })
    .returning();
  return orThrow(row);
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
  if (testProviderEventIds.length > 0) {
    await db.delete(paymentEventTable).where(inArray(paymentEventTable.providerEventId, testProviderEventIds));
  }
  if (testOrderIds.length > 0) {
    await db.delete(orderEventTable).where(inArray(orderEventTable.orderId, testOrderIds));
    await db.delete(paymentTable).where(inArray(paymentTable.orderId, testOrderIds));
    await db.delete(orderTable).where(inArray(orderTable.id, testOrderIds));
  }
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

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("PENDING_PAYMENT");
    const events = await db.query.paymentEvent.findMany({
      where: eq(paymentEventTable.providerEventId, payload.providerEventId),
    });
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

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("PAID");
    expect(reloaded.pickupNumber).not.toBeNull();
    expect(reloaded.paidAt).not.toBeNull();

    const payment = orThrow(await db.query.payment.findFirst({ where: eq(paymentTable.orderId, order.id) }));
    expect(payment.status).toBe("SUCCEEDED");

    const events = await db.query.orderEvent.findMany({ where: eq(orderEventTable.orderId, order.id) });
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

    const events = await db.query.orderEvent.findMany({ where: eq(orderEventTable.orderId, order.id) });
    expect(events).toHaveLength(1); // 沒有因重送而重複轉移

    const paymentEvents = await db.query.paymentEvent.findMany({
      where: and(eq(paymentEventTable.provider, "mock"), eq(paymentEventTable.providerEventId, payload.providerEventId)),
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

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe("PENDING_PAYMENT");
    expect(reloaded.pickupNumber).toBeNull();

    const payment = orThrow(await db.query.payment.findFirst({ where: eq(paymentTable.orderId, order.id) }));
    expect(payment.failureCode).toBe("AMOUNT_MISMATCH");
  });
});
