import type { Prisma } from "@/generated/prisma/client";

export type DailySalesEvent = "PAID" | "REFUNDED";

type SalesItem = {
  productId: string;
  quantity: number;
  lineTotal: number;
  nameSnapshot: unknown;
};

function productNameZhFrom(nameSnapshot: unknown): string {
  if (nameSnapshot && typeof nameSnapshot === "object" && "ZH_TW" in nameSnapshot) {
    const name = (nameSnapshot as Record<string, unknown>).ZH_TW;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * 見 SPEC.md §11 更新機制：於 → PAID／→ REFUNDED 轉移的同一交易內呼叫（見
 * server/payment/webhook.ts、reconcile.ts、refund.ts），對每個 OrderItem 的
 * productId 做原子累加，不讀取現有值再寫回，避免併發下的讀寫競態。
 *
 * netQuantity = quantitySold − refundedQty、netAmount 同理：PAID 讓 net 增加、
 * REFUNDED 讓 net 減少，方向剛好與各自累加的欄位相反，故在同一次 upsert 內
 * 一併算好，讀取端（報表／summary）不需要再重算。
 *
 * REFUNDED 事件永遠發生在同一 productId 已經被 PAID 事件寫過一次之後（見
 * SPEC.md §6.2 狀態機：REFUNDED 只能從 PAID/PREPARING/READY/COMPLETED 轉入），
 * 所以 create 分支理論上不會真的被 REFUNDED 事件觸發，這裡仍給出合理的初始值
 * 只是防禦性寫法。
 */
export async function applyDailyProductSales(
  tx: Prisma.TransactionClient,
  event: DailySalesEvent,
  params: { storeId: string; businessDate: Date; items: SalesItem[] },
): Promise<void> {
  const isPaid = event === "PAID";

  for (const item of params.items) {
    const productNameZh = productNameZhFrom(item.nameSnapshot);

    await tx.dailyProductSales.upsert({
      where: {
        storeId_businessDate_productId: {
          storeId: params.storeId,
          businessDate: params.businessDate,
          productId: item.productId,
        },
      },
      create: {
        storeId: params.storeId,
        businessDate: params.businessDate,
        productId: item.productId,
        productNameZh,
        quantitySold: isPaid ? item.quantity : 0,
        grossAmount: isPaid ? item.lineTotal : 0,
        refundedQty: isPaid ? 0 : item.quantity,
        refundedAmount: isPaid ? 0 : item.lineTotal,
        netQuantity: isPaid ? item.quantity : -item.quantity,
        netAmount: isPaid ? item.lineTotal : -item.lineTotal,
      },
      update: {
        quantitySold: isPaid ? { increment: item.quantity } : undefined,
        grossAmount: isPaid ? { increment: item.lineTotal } : undefined,
        refundedQty: isPaid ? undefined : { increment: item.quantity },
        refundedAmount: isPaid ? undefined : { increment: item.lineTotal },
        netQuantity: { increment: isPaid ? item.quantity : -item.quantity },
        netAmount: { increment: isPaid ? item.lineTotal : -item.lineTotal },
      },
    });
  }
}
