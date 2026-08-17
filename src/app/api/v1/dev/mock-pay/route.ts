import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { order as orderTable } from "@/db/schema";
import { AppError, toErrorResponse } from "@/lib/errors";
import { signMockPayload, type MockWebhookPayload } from "@/lib/payment/providers/mock";

const bodySchema = z.object({
  orderNo: z.string().min(1),
  paymentId: z.string().min(1),
  outcome: z.enum(["SUCCESS", "FAILED"]),
});

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

/**
 * 見 SPEC.md §7.4：/dev/mock-pay 頁面按下按鈕後，由「伺服器自行」POST 至
 * /api/v1/payments/webhook/mock，走與真實 webhook 完全相同的處理路徑（含驗簽）。
 * 僅 NODE_ENV !== "production" 時可用。
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }

  try {
    const { orderNo, paymentId, outcome } = bodySchema.parse(await request.json());

    const db = await getDb();
    const order = await db.query.order.findFirst({ where: eq(orderTable.orderNo, orderNo) });
    if (!order) {
      throw new AppError("NOT_FOUND", "訂單不存在");
    }

    const payload: MockWebhookPayload = {
      providerEventId: randomUUID(),
      paymentId,
      orderNo,
      amount: order.totalAmount,
      currency: order.currency,
      eventType: outcome === "SUCCESS" ? "charge.succeeded" : "charge.failed",
      paidAt: outcome === "SUCCESS" ? new Date().toISOString() : undefined,
    };
    const rawBody = JSON.stringify(payload);
    const signature = signMockPayload(rawBody);

    const response = await fetch(`${APP_BASE_URL}/api/v1/payments/webhook/mock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mock-signature": signature },
      body: rawBody,
    });

    return NextResponse.json({ forwarded: true, webhookStatus: response.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
