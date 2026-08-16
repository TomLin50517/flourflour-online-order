import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PaymentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  RawWebhook,
  WebhookEvent,
} from "../types";

// 見 SPEC.md §7.4：唯一要求「完整可用」的 provider，讓下單→付款→配號可在無廠商 API 時完整跑通。

export type MockChargeOutcome = "SUCCESS" | "FAILED" | "CANCELLED";

export type MockWebhookPayload = {
  providerEventId: string;
  paymentId: string; // mock 自行產生的交易識別碼，同時作為 providerRef
  orderNo: string;
  amount: number;
  currency: string;
  eventType: "charge.succeeded" | "charge.failed" | "charge.cancelled";
  paidAt?: string;
};

const SIGNATURE_HEADER = "x-mock-signature";

function getSecret(): string {
  const secret = process.env.MOCK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("MOCK_WEBHOOK_SECRET 未設定");
  }
  return secret;
}

/** 供 /dev/mock-pay 觸發端點簽署 payload 時複用，確保與 verifySignature 使用同一套演算法。 */
export function signMockPayload(rawBody: string): string {
  return createHmac("sha256", getSecret()).update(rawBody).digest("hex");
}

export class MockProvider implements PaymentProvider {
  readonly code = "mock" as const;

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const paymentId = randomUUID();
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const redirectUrl = `${baseUrl}/dev/mock-pay?orderNo=${encodeURIComponent(input.orderNo)}&paymentId=${paymentId}`;
    return { mode: "REDIRECT", paymentId, providerRef: paymentId, redirectUrl };
  }

  verifySignature(raw: RawWebhook): boolean {
    const provided = raw.headers[SIGNATURE_HEADER];
    if (!provided) return false;

    const expected = signMockPayload(raw.rawBody);
    const providedBuf = Buffer.from(provided, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  }

  parseWebhook(raw: RawWebhook): WebhookEvent {
    const payload = JSON.parse(raw.rawBody) as MockWebhookPayload;
    return {
      providerEventId: payload.providerEventId,
      eventType: payload.eventType,
      providerRef: payload.paymentId,
      orderNo: payload.orderNo,
      amount: payload.amount,
      currency: payload.currency,
      paidAt: payload.paidAt ? new Date(payload.paidAt) : undefined,
      method: "CREDIT_CARD",
      raw: payload,
    };
  }

  async queryCharge(providerRef: string): Promise<{ status: PaymentStatus; amount: number; paidAt?: Date }> {
    // Mock 無外部伺服器可查，改以自家 Payment 表模擬「向廠商查詢」的結果。
    const payment = await prisma.payment.findFirst({ where: { provider: "mock", providerRef } });
    if (!payment) {
      return { status: PaymentStatus.PENDING, amount: 0 };
    }
    return { status: payment.status, amount: payment.amount, paidAt: payment.paidAt ?? undefined };
  }

  async refund(input: { providerRef: string; amount: number; reason?: string }): Promise<{ ok: boolean; refundRef?: string }> {
    void input;
    return { ok: true, refundRef: randomUUID() };
  }

  resolveReturn(query: Record<string, string>): { orderNo?: string; hint: "SUCCESS" | "FAILED" | "UNKNOWN" } {
    return { orderNo: query.orderNo, hint: "UNKNOWN" };
  }
}
