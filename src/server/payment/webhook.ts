import { and, desc, eq } from "drizzle-orm";
import { getDb, type DbOrTx, type Tx } from "@/db/client";
import { isUniqueConstraintError, orThrow } from "@/db/helpers";
import {
  order as orderTable,
  orderItem as orderItemTable,
  payment as paymentTable,
  paymentEvent as paymentEventTable,
} from "@/db/schema";
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

function markProcessed(db: DbOrTx, eventId: string) {
  return db.update(paymentEventTable).set({ processedAt: new Date() }).where(eq(paymentEventTable.id, eventId));
}

async function findPaymentForEvent(
  tx: Tx,
  orderId: string,
  providerCode: ProviderCode,
  event: WebhookEvent,
) {
  const byRef = await tx.query.payment.findFirst({
    where: and(
      eq(paymentTable.orderId, orderId),
      eq(paymentTable.provider, providerCode),
      // 見 docs/DRIZZLE-MIGRATION-SPEC.md §4.8：event.providerRef 可能不存在，
      // 此時原本 Prisma 版本的行為是「不過濾這個欄位」，非「等於空值」。
      event.providerRef ? eq(paymentTable.providerRef, event.providerRef) : undefined,
    ),
  });
  if (byRef) return byRef;

  // 部分廠商在建立交易時不會馬上回傳 providerRef，退而求其次比對「最近一筆待付款紀錄」。
  return tx.query.payment.findFirst({
    where: and(
      eq(paymentTable.orderId, orderId),
      eq(paymentTable.provider, providerCode),
      eq(paymentTable.status, "PENDING"),
    ),
    orderBy: [desc(paymentTable.createdAt)],
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
  const db = await getDb();
  const provider = getPaymentProvider(providerCode);

  if (!provider.verifySignature(raw)) {
    throw new WebhookSignatureError();
  }

  const event = provider.parseWebhook(raw);

  let eventRow;
  try {
    [eventRow] = await db
      .insert(paymentEventTable)
      .values({
        provider: providerCode,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payload: maskSensitive(event.raw),
        signatureValid: true,
      })
      .returning();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "DUPLICATE";
    }
    throw error;
  }

  const order = await db.query.order.findFirst({ where: eq(orderTable.orderNo, event.orderNo) });
  if (!order) {
    // 找不到訂單：異常情況，不標記 processedAt，留給補償 job／人工排查；webhook 仍回 200。
    return "IGNORED";
  }

  if (event.eventType === "charge.failed" || event.eventType === "charge.cancelled") {
    await db
      .update(paymentTable)
      .set({
        status: event.eventType === "charge.failed" ? "FAILED" : "CANCELLED",
        failureCode: event.failure?.code,
        failureMessage: event.failure?.message,
      })
      .where(
        and(
          eq(paymentTable.orderId, order.id),
          eq(paymentTable.provider, providerCode),
          eq(paymentTable.status, "PENDING"),
        ),
      );
    await markProcessed(db, eventRow.id);
    return "IGNORED";
  }

  if (event.eventType !== "charge.succeeded") {
    // 例如 refund.succeeded／unknown：退款流程由 server/payment/refund.ts 主動觸發，
    // 這裡只記錄事件，不做額外狀態轉移。
    await markProcessed(db, eventRow.id);
    return "IGNORED";
  }

  if (event.amount !== order.totalAmount) {
    await db
      .update(paymentTable)
      .set({
        failureCode: "AMOUNT_MISMATCH",
        failureMessage: `webhook amount ${event.amount} != order.totalAmount ${order.totalAmount}`,
      })
      .where(
        and(
          eq(paymentTable.orderId, order.id),
          eq(paymentTable.provider, providerCode),
          eq(paymentTable.status, "PENDING"),
        ),
      );
    await markProcessed(db, eventRow.id);
    return "AMOUNT_MISMATCH";
  }

  await db.transaction(async (tx) => {
    const freshOrder = orThrow(await tx.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    const payment = await findPaymentForEvent(tx, order.id, providerCode, event);
    const paidAt = event.paidAt ?? new Date();

    if (payment) {
      await tx
        .update(paymentTable)
        .set({
          status: "SUCCEEDED",
          providerRef: event.providerRef,
          method: event.method,
          cardBrand: event.card?.brand,
          cardLast4: event.card?.last4,
          paidAt,
        })
        .where(eq(paymentTable.id, payment.id));
    }

    if (freshOrder.status === "PENDING_PAYMENT") {
      const store = orThrow(await tx.query.store.findFirst());
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
      const items = await tx.query.orderItem.findMany({ where: eq(orderItemTable.orderId, order.id) });
      await applyDailyProductSales(tx, "PAID", { storeId: store.id, businessDate, items });
    }
    // 訂單已非 PENDING_PAYMENT（例如同一筆交易的重送事件帶了不同 providerEventId）：
    // Payment 已同步更新，視為冪等成功，不重複轉移訂單狀態。

    await tx
      .update(paymentEventTable)
      .set({ processedAt: new Date(), paymentId: payment?.id })
      .where(eq(paymentEventTable.id, eventRow.id));
  });

  return "PROCESSED";
}
