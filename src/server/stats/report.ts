import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orThrow } from "@/db/helpers";
import { dailyProductSales, order } from "@/db/schema";
import { toBusinessDate } from "@/server/order/business-date";

export type DailyProductSalesRow = {
  productId: string;
  productNameZh: string;
  quantitySold: number;
  grossAmount: number;
  refundedQty: number;
  refundedAmount: number;
  netQuantity: number;
  netAmount: number;
  sharePercent: number;
};

/**
 * 見 SPEC.md §8.3 GET /admin/stats/daily-product-sales、§10.5：
 * 依區間彙總每個商品的銷售量表，預設依淨數量降冪排序（前端可再依其他欄位重新排序，
 * 不需要為此另開 API 參數）。佔比（sharePercent）以「淨數量佔區間內全部商品淨數量
 * 總和」計算，與預設排序欄位一致。
 */
export async function getDailyProductSalesReport(params: {
  from: Date;
  to: Date;
  productId?: string;
}): Promise<{ from: Date; to: Date; items: DailyProductSalesRow[] }> {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());

  const rows = await db.query.dailyProductSales.findMany({
    where: and(
      eq(dailyProductSales.storeId, store.id),
      gte(dailyProductSales.businessDate, params.from),
      lte(dailyProductSales.businessDate, params.to),
      params.productId ? eq(dailyProductSales.productId, params.productId) : undefined,
    ),
    orderBy: [dailyProductSales.businessDate],
  });

  const byProduct = new Map<string, DailyProductSalesRow>();
  for (const row of rows) {
    const existing = byProduct.get(row.productId) ?? {
      productId: row.productId,
      productNameZh: row.productNameZh,
      quantitySold: 0,
      grossAmount: 0,
      refundedQty: 0,
      refundedAmount: 0,
      netQuantity: 0,
      netAmount: 0,
      sharePercent: 0,
    };
    existing.productNameZh = row.productNameZh; // 用區間內最新一天的名稱快照顯示
    existing.quantitySold += row.quantitySold;
    existing.grossAmount += row.grossAmount;
    existing.refundedQty += row.refundedQty;
    existing.refundedAmount += row.refundedAmount;
    existing.netQuantity += row.netQuantity;
    existing.netAmount += row.netAmount;
    byProduct.set(row.productId, existing);
  }

  const items = Array.from(byProduct.values());
  const totalNetQuantity = items.reduce((sum, item) => sum + item.netQuantity, 0);
  for (const item of items) {
    item.sharePercent =
      totalNetQuantity > 0 ? Math.round((item.netQuantity / totalNetQuantity) * 1000) / 10 : 0;
  }
  items.sort((a, b) => b.netQuantity - a.netQuantity);

  return { from: params.from, to: params.to, items };
}

export type StatsSummary = {
  from: Date;
  to: Date;
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  refundAmount: number;
  topProducts: Array<{ productId: string; productNameZh: string; netQuantity: number; netAmount: number }>;
  dailyTrend: Array<{ businessDate: Date; orderCount: number; revenue: number }>;
};

function resolveRange(
  params: { from?: Date; to?: Date },
  store: { timezone: string; businessDayCutoff: string },
): { from: Date; to: Date } {
  if (params.from && params.to) {
    return { from: params.from, to: params.to };
  }
  // 見 SPEC.md §8.3：summary 端點未帶區間時，以「當日」（今日營業日）為預設範圍。
  const today = toBusinessDate(new Date(), store.timezone, store.businessDayCutoff);
  return { from: params.from ?? today, to: params.to ?? today };
}

/**
 * 見 SPEC.md §8.3 GET /admin/stats/summary、§10.5 KPI 卡：
 * 總營收（revenue，毛額）、訂單數、平均客單價、退款金額，另加熱銷 Top 10
 * （§10.5 頁面需求，與 summary 端點合併回傳，避免前端多一次請求）。
 */
export async function getStatsSummary(params: { from?: Date; to?: Date }): Promise<StatsSummary> {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  const { from, to } = resolveRange(params, store);

  const paidOrderRange = and(
    eq(order.storeId, store.id),
    gte(order.businessDate, from),
    lte(order.businessDate, to),
    isNotNull(order.paidAt),
  );
  const salesRange = and(
    eq(dailyProductSales.storeId, store.id),
    gte(dailyProductSales.businessDate, from),
    lte(dailyProductSales.businessDate, to),
  );

  const [orderAggRows, refundAggRows, topProducts, dailyOrders] = await Promise.all([
    db
      .select({
        sum: sql<number>`coalesce(sum(${order.totalAmount}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(order)
      .where(paidOrderRange),
    db
      .select({ sum: sql<number>`coalesce(sum(${dailyProductSales.refundedAmount}), 0)::int` })
      .from(dailyProductSales)
      .where(salesRange),
    db
      .select({
        productId: dailyProductSales.productId,
        netQuantity: sql<number>`coalesce(sum(${dailyProductSales.netQuantity}), 0)::int`,
        netAmount: sql<number>`coalesce(sum(${dailyProductSales.netAmount}), 0)::int`,
      })
      .from(dailyProductSales)
      .where(salesRange)
      .groupBy(dailyProductSales.productId)
      .orderBy((t) => desc(t.netQuantity))
      .limit(10),
    // 見 SPEC.md §10.5：趨勢圖需要「區間內每日」訂單數與營收，與上面 orderAgg
    // 的整段區間彙總是不同的聚合軸，故另外依 businessDate 分組。
    db
      .select({
        businessDate: order.businessDate,
        revenue: sql<number>`coalesce(sum(${order.totalAmount}), 0)::int`,
        orderCount: sql<number>`count(*)::int`,
      })
      .from(order)
      .where(paidOrderRange)
      .groupBy(order.businessDate)
      .orderBy(order.businessDate),
  ]);

  const revenue = orderAggRows[0]?.sum ?? 0;
  const orderCount = orderAggRows[0]?.count ?? 0;
  const avgOrderValue = orderCount > 0 ? Math.round(revenue / orderCount) : 0;
  const refundAmount = refundAggRows[0]?.sum ?? 0;

  const productIds = topProducts.map((p) => p.productId);
  const nameRows = productIds.length
    ? await db.query.dailyProductSales.findMany({
        where: and(salesRange, inArray(dailyProductSales.productId, productIds)),
        columns: { productId: true, productNameZh: true },
        orderBy: [desc(dailyProductSales.businessDate)],
      })
    : [];
  const nameByProduct = new Map<string, string>();
  for (const row of nameRows) {
    if (!nameByProduct.has(row.productId)) nameByProduct.set(row.productId, row.productNameZh);
  }

  return {
    from,
    to,
    revenue,
    orderCount,
    avgOrderValue,
    refundAmount,
    topProducts: topProducts.map((p) => ({
      productId: p.productId,
      productNameZh: nameByProduct.get(p.productId) ?? "",
      netQuantity: p.netQuantity,
      netAmount: p.netAmount,
    })),
    dailyTrend: dailyOrders
      .filter((row): row is typeof row & { businessDate: Date } => row.businessDate !== null)
      .map((row) => ({
        businessDate: row.businessDate,
        orderCount: row.orderCount,
        revenue: row.revenue,
      })),
  };
}
