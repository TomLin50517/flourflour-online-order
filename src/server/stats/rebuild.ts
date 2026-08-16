import { getDb } from "@/lib/db";

export type RebuildResult = {
  from: Date;
  to: Date;
  ordersConsidered: number;
  rowsWritten: number;
};

type Agg = {
  productId: string;
  productNameZh: string;
  quantitySold: number;
  grossAmount: number;
  refundedQty: number;
  refundedAmount: number;
};

/**
 * 見 SPEC.md §11「一致性檢查」：由 Order/OrderItem 明細全量重算 DailyProductSales，
 * 作為對帳與修復手段（`npm run stats:rebuild`）。刻意與即時累加路徑
 * （applyDailyProductSales，見 webhook.ts / reconcile.ts 的 PAID 分支、refund.ts 的
 * REFUNDED 分支）採用完全相同的語意：
 *
 * - 任何「曾經付款成功」的訂單（`paidAt` 不為 null，不論目前狀態，包含 REFUNDED）
 *   都計入 quantitySold/grossAmount。REFUNDED 只是「PAID 之後又追加發生的另一件
 *   事」，不代表這筆訂單從未付款過。若改成「目前狀態必須 ∈ {PAID,PREPARING,
 *   READY,COMPLETED}」才計入 quantitySold，REFUNDED 訂單就完全不會被計入
 *   quantitySold，會讓 netQuantity = quantitySold − refundedQty 對這些商品變成
 *   負數，與 §11「netQuantity 為報表預設欄位」的用途矛盾——這點 SPEC §11 條列
 *   容易誤讀，見 docs/OPEN-QUESTIONS.md 的說明。
 * - 目前狀態為 REFUNDED 的訂單，額外計入 refundedQty/refundedAmount。
 * - 全部歸屬於 `order.businessDate`（PAID 當下配發的營業日，退款不會改變它）。
 */
export async function rebuildDailyProductSales(params: {
  from: Date;
  to: Date;
  storeId?: string;
}): Promise<RebuildResult> {
  const prisma = await getDb();
  const store = params.storeId ? { id: params.storeId } : await prisma.store.findFirstOrThrow();

  const orders = await prisma.order.findMany({
    where: {
      storeId: store.id,
      businessDate: { gte: params.from, lte: params.to },
      paidAt: { not: null },
    },
    include: { items: true },
  });

  const byKey = new Map<string, Agg>();

  for (const order of orders) {
    if (!order.businessDate) continue; // 理論上不會發生：paidAt 與 businessDate 同時配發（見 §6.3）
    const dateKey = order.businessDate.toISOString();

    for (const item of order.items) {
      const key = `${dateKey}::${item.productId}`;
      const nameSnapshot = item.nameSnapshot as Record<string, string> | null;
      const existing: Agg = byKey.get(key) ?? {
        productId: item.productId,
        productNameZh: nameSnapshot?.ZH_TW ?? "",
        quantitySold: 0,
        grossAmount: 0,
        refundedQty: 0,
        refundedAmount: 0,
      };

      existing.quantitySold += item.quantity;
      existing.grossAmount += item.lineTotal;
      if (order.status === "REFUNDED") {
        existing.refundedQty += item.quantity;
        existing.refundedAmount += item.lineTotal;
      }

      byKey.set(key, existing);
    }
  }

  const rows = Array.from(byKey.entries()).map(([key, agg]) => {
    const [dateIso] = key.split("::");
    return {
      storeId: store.id,
      businessDate: new Date(dateIso),
      productId: agg.productId,
      productNameZh: agg.productNameZh,
      quantitySold: agg.quantitySold,
      grossAmount: agg.grossAmount,
      refundedQty: agg.refundedQty,
      refundedAmount: agg.refundedAmount,
      netQuantity: agg.quantitySold - agg.refundedQty,
      netAmount: agg.grossAmount - agg.refundedAmount,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.dailyProductSales.deleteMany({
      where: { storeId: store.id, businessDate: { gte: params.from, lte: params.to } },
    });
    if (rows.length > 0) {
      await tx.dailyProductSales.createMany({ data: rows });
    }
  });

  return { from: params.from, to: params.to, ordersConsidered: orders.length, rowsWritten: rows.length };
}
