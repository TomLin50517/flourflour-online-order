import { prisma } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment/registry";
import type { ProviderCode } from "@/lib/payment/types";
import { assignPickupNumber } from "@/server/order/pickup-number";
import { transition } from "@/server/order/state-machine";
import { applyDailyProductSales } from "@/server/stats/daily-product-sales";

const RECONCILE_AFTER_MINUTES = 3;

/**
 * 見 SPEC.md §7.5 關鍵原則 5：每 5 分鐘掃描 PENDING_PAYMENT 且下單超過 3 分鐘的訂單，
 * 主動呼叫 queryCharge() 解決 webhook 遺失的情況。成功後與 webhook 路徑共用同一套
 * 「更新 Payment → 配發 pickupNumber → transition 到 PAID」邏輯。
 */
export async function reconcilePendingPayments(now: Date = new Date()) {
  const threshold = new Date(now.getTime() - RECONCILE_AFTER_MINUTES * 60 * 1000);
  const candidates = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", placedAt: { lt: threshold } },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  let checked = 0;
  let reconciled = 0;

  for (const order of candidates) {
    const payment = order.payments[0];
    if (!payment?.providerRef) continue; // 從未成功呼叫過 createCharge，沒有可查詢的對象
    checked += 1;

    let queried;
    try {
      const provider = getPaymentProvider(payment.provider as ProviderCode);
      queried = await provider.queryCharge(payment.providerRef);
    } catch (error) {
      // 廠商 adapter 未實作（NotImplementedError）或查詢暫時失敗：留給下一輪重試。
      console.error("reconcilePendingPayments: queryCharge failed", { orderNo: order.orderNo, error });
      continue;
    }

    if (queried.status !== "SUCCEEDED") continue;
    if (queried.amount !== order.totalAmount) continue; // 見 §7.5 金額比對原則，不轉狀態

    const paidAt = queried.paidAt ?? now;

    await prisma.$transaction(async (tx) => {
      const freshOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (freshOrder.status !== "PENDING_PAYMENT") return; // 已被 webhook 搶先處理

      await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", paidAt } });

      const store = await tx.store.findFirstOrThrow();
      const { pickupNumber, businessDate, pickupSeq } = await assignPickupNumber(tx, store, paidAt);

      await transition({
        tx,
        orderId: order.id,
        expectedVersion: freshOrder.version,
        toStatus: "PAID",
        actorType: "PAYMENT_WEBHOOK",
        note: "由對帳補償 job 主動查詢後確認付款成功",
        extraData: { paidAt, pickupNumber, businessDate, pickupSeq },
      });

      // 見 SPEC.md §11：於 → PAID 的同一交易內累加 DailyProductSales。
      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      await applyDailyProductSales(tx, "PAID", { storeId: store.id, businessDate, items });
    });
    reconciled += 1;
  }

  return { candidates: candidates.length, checked, reconciled };
}
