import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isProviderCode } from "@/lib/payment/registry";
import type { RawWebhook } from "@/lib/payment/types";
import { webhookProviderParamsSchema } from "@/schemas/payment";
import { handlePaymentWebhook, WebhookSignatureError } from "@/server/payment/webhook";

// 見 SPEC.md §12.1：空值代表不限制來源 IP（正式環境須設定）。
function isIpAllowed(ip: string | null): boolean {
  const allowList = process.env.PAYMENT_WEBHOOK_ALLOWED_IPS;
  if (!allowList) return true;
  const allowed = allowList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ip !== null && allowed.includes(ip);
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/v1/payments/webhook/[provider]">,
) {
  try {
    const { provider } = webhookProviderParamsSchema.parse(await context.params);
    if (!isProviderCode(provider)) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "未知的金流廠商" } }, { status: 404 });
    }

    const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    if (!isIpAllowed(clientIp)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "來源 IP 不在白名單內" } },
        { status: 403 },
      );
    }

    // ★ 見 CLAUDE.md 陷阱 #8：務必先取原始字串再驗簽，不可先 JSON.parse。
    const rawBody = await request.text();
    const raw: RawWebhook = {
      headers: Object.fromEntries(request.headers.entries()),
      rawBody,
      query: Object.fromEntries(request.nextUrl.searchParams.entries()),
    };

    const outcome = await handlePaymentWebhook(provider, raw);
    return NextResponse.json({ received: true, outcome }, { status: 200 });
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      // 見 SPEC.md §12.3：webhook 驗簽失敗是需要告警的事件之一。
      logger.alert("webhook signature verification failed", {
        message: error.message,
        requestId: request.headers.get("x-request-id") ?? randomUUID(),
      });
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof ZodError) {
      return toErrorResponse(error);
    }
    // 見 SPEC.md §7.5 關鍵原則 4：webhook 一律回 200（除非驗簽失敗），避免廠商無限重送；
    // 失敗細節已於 handlePaymentWebhook 內部記錄，PaymentEvent.processedAt 會維持 null 供補償 job 重試。
    logger.error("payment webhook unexpected error", {
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
      requestId: request.headers.get("x-request-id") ?? randomUUID(),
    });
    return NextResponse.json({ received: true }, { status: 200 });
  }
}
