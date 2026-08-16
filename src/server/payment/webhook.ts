import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { maskSensitive } from "@/lib/payment/mask";
import { getPaymentProvider } from "@/lib/payment/registry";
import type { ProviderCode, RawWebhook, WebhookEvent } from "@/lib/payment/types";
import { assignPickupNumber } from "@/server/order/pickup-number";
import { transition } from "@/server/order/state-machine";
import { applyDailyProductSales } from "@/server/stats/daily-product-sales";

export class WebhookSignatureError extends Error {
  constructor(message = "驗簽失敗") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export type WebhookOutcome = "PROCESSED" | "DUPLICATE" | "AMOUNT_MISMATCH" | "IGNORED";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function markProcessed(eventId: string) {
  return prisma.paymentEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
}

async function findPaymentForEvent(
  tx: Prisma.TransactionClient,
  orderId: string,
  providerCode: ProviderCode,
  event: WebhookEvent,
) {
  const byRef = await tx.payment.findFirst({
    where: { orderId, provider: providerCode, providerRef: event.providerRef },
  });
  if (byRef) return byRef;

  // 部分廠商在建立交易時不會馬上回傳 providerRef，退而求其次比對「最近一筆待付款紀錄」。
  return tx.payment.findFirst({
    where: { orderId, provider: providerCode, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 見 SPEC.md §7.5 / §8.2：webhook 處理核心流程。供
 * app/api/v1/payments/webhook/[provider] 呼叫，亦可在測試中直接呼叫。
 *
 * 呼叫端規則（CLAUDE.md 陷阱 #8、SPEC §7.5 關鍵原則 3/4）：
 * 只有「驗簽失敗」才視為錯誤（400）；其餘一律視為已處理並回 200 ——
 * 即使處理過程中發生非預期錯誤，也只是不呼叫 markProcessed()，
 * 讓 PaymentEvent.processedAt 保持 null 以供補償 job／人工重新處理，不得讓端點回非 200。
 */
export async function handlePaymentWebhook(
  providerCode: ProviderCode,
  raw: RawWebhook,
): Promise<WebhookOutcome> {
  const provider = getPaymentProvider(providerCode);

  if (!provider.verifySignature(raw)) {
    throw new WebhookSignatureError();
  }

  const event = provider.parseWebhook(raw);

  let eventRow;
  try {
    eventRow = await prisma.paymentEvent.create({
      data: {
        provider: providerCode,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payload: maskSensitive(event.raw) as Prisma.InputJsonValue,
        signatureValid: true,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "DUPLICATE";
    }
    throw error;
  }

  const order = await prisma.order.findUnique({ where: { orderNo: event.orderNo } });
  if (!order) {
    // 找不到訂單：異常情況，不標記 processedAt，留給補償 job／人工排查；webhook 仍回 200。
    return "IGNORED";
  }

  if (event.eventType === "charge.failed" || event.eventType === "charge.cancelled") {
    await prisma.payment.updateMany({
      where: { orderId: order.id, provider: providerCode, status: "PENDING" },
      data: {
        status: event.eventType === "charge.failed" ? "FAILED" : "CANCELLED",
        failureCode: event.failure?.code,
        failureMessage: event.failure?.message,
      },
    });
    await markProcessed(eventRow.id);
    return "IGNORED";
  }

  if (event.eventType !== "charge.succeeded") {
    // 例如 refund.succeeded／unknown：退款流程由 server/payment/refund.ts 主動觸發，
    // 這裡只記錄事件，不做額外狀態轉移。
    await markProcessed(eventRow.id);
    return "IGNORED";
  }

  if (event.amount !== order.totalAmount) {
    await prisma.payment.updateMany({
      where: { orderId: order.id, provider: providerCode, status: "PENDING" },
      data: {
        failureCode: "AMOUNT_MISMATCH",
        failureMessage: `webhook amount ${event.amount} != order.totalAmount ${order.totalAmount}`,
      },
    });
    await markProcessed(eventRow.id);
    return "AMOUNT_MISMATCH";
  }

  await prisma.$transaction(async (tx) => {
    const freshOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    const payment = await findPaymentForEvent(tx, order.id, providerCode, event);
    const paidAt = event.paidAt ?? new Date();

    if (payment) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          providerRef: event.providerRef,
          method: event.method,
          cardBrand: event.card?.brand,
          cardLast4: event.card?.last4,
          paidAt,
        },
      });
    }

    if (freshOrder.status === "PENDING_PAYMENT") {
      const store = await tx.store.findFirstOrThrow();
      const { pickupNumber, businessDate, pickupSeq } = await assignPickupNumber(tx, store, paidAt);

      await transition({
        tx,
        orderId: order.id,
        expectedVersion: freshOrder.version,
        toStatus: "PAID",
        actorType: "PAYMENT_WEBHOOK",
        extraData: { paidAt, pickupNumber, businessDate, pickupSeq },
      });

      // 見 SPEC.md §11：於 → PAID 的同一交易內累加 DailyProductSales。
      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      await applyDailyProductSales(tx, "PAID", { storeId: store.id, businessDate, items });
    }
    // 訂單已非 PENDING_PAYMENT（例如同一筆交易的重送事件帶了不同 providerEventId）：
    // Payment 已同步更新，視為冪等成功，不重複轉移訂單狀態。

    await tx.paymentEvent.update({
      where: { id: eventRow.id },
      data: { processedAt: new Date(), paymentId: payment?.id },
    });
  });

  return "PROCESSED";
}
