import { describe, expect, it } from "vitest";
import { MockProvider, signMockPayload, type MockWebhookPayload } from "@/lib/payment/providers/mock";

describe("MockProvider", () => {
  const provider = new MockProvider();

  it("createCharge returns a REDIRECT result pointing at /dev/mock-pay", async () => {
    const result = await provider.createCharge({
      orderId: "order_1",
      orderNo: "ORD-20260815-0001",
      amount: 100,
      currency: "TWD",
      locale: "zh-TW",
      idempotencyKey: "idem_1",
      items: [{ name: "test", quantity: 1, unitPrice: 100 }],
      returnUrl: "http://localhost:3000/zh-TW/order/ORD-20260815-0001",
      notifyUrl: "http://localhost:3000/api/v1/payments/webhook/mock",
    });

    expect(result.mode).toBe("REDIRECT");
    if (result.mode === "REDIRECT") {
      expect(result.redirectUrl).toContain("/dev/mock-pay");
      expect(result.redirectUrl).toContain("orderNo=ORD-20260815-0001");
      expect(result.paymentId).toBe(result.providerRef);
    }
  });

  it("verifySignature accepts a correctly signed payload and rejects a tampered/missing one", () => {
    const payload: MockWebhookPayload = {
      providerEventId: "evt_1",
      paymentId: "pay_1",
      orderNo: "ORD-20260815-0001",
      amount: 100,
      currency: "TWD",
      eventType: "charge.succeeded",
    };
    const rawBody = JSON.stringify(payload);
    const signature = signMockPayload(rawBody);

    expect(
      provider.verifySignature({ headers: { "x-mock-signature": signature }, rawBody, query: {} }),
    ).toBe(true);
    expect(
      provider.verifySignature({ headers: { "x-mock-signature": "0".repeat(64) }, rawBody, query: {} }),
    ).toBe(false);
    expect(provider.verifySignature({ headers: {}, rawBody, query: {} })).toBe(false);
  });

  it("parseWebhook maps the payload into a WebhookEvent", () => {
    const payload: MockWebhookPayload = {
      providerEventId: "evt_2",
      paymentId: "pay_2",
      orderNo: "ORD-20260815-0002",
      amount: 200,
      currency: "TWD",
      eventType: "charge.succeeded",
      paidAt: "2026-08-15T03:00:00.000Z",
    };
    const rawBody = JSON.stringify(payload);

    const event = provider.parseWebhook({ headers: {}, rawBody, query: {} });
    expect(event.providerEventId).toBe("evt_2");
    expect(event.providerRef).toBe("pay_2");
    expect(event.orderNo).toBe("ORD-20260815-0002");
    expect(event.amount).toBe(200);
    expect(event.paidAt).toEqual(new Date("2026-08-15T03:00:00.000Z"));
  });
});
