import { prisma } from "@/lib/db";
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
  const store = await prisma.store.findFirstOrThrow();

  const rows = await prisma.dailyProductSales.findMany({
    where: {
      storeId: store.id,
      businessDate: { gte: params.from, lte: params.to },
      ...(params.productId ? { productId: params.productId } : {}),
    },
    orderBy: { businessDate: "asc" },
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
  const store = await prisma.store.findFirstOrThrow();
  const { from, to } = resolveRange(params, store);

  const [orderAgg, refundAgg, topProducts, dailyOrders] = await Promise.all([
    prisma.order.aggregate({
      where: { storeId: store.id, businessDate: { gte: from, lte: to }, paidAt: { not: null } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.dailyProductSales.aggregate({
      where: { storeId: store.id, businessDate: { gte: from, lte: to } },
      _sum: { refundedAmount: true },
    }),
    prisma.dailyProductSales.groupBy({
      by: ["productId"],
      where: { storeId: store.id, businessDate: { gte: from, lte: to } },
      _sum: { netQuantity: true, netAmount: true },
      orderBy: { _sum: { netQuantity: "desc" } },
      take: 10,
    }),
    // 見 SPEC.md §10.5：趨勢圖需要「區間內每日」訂單數與營收，與上面 orderAgg
    // 的整段區間彙總是不同的聚合軸，故另外依 businessDate 分組。
    prisma.order.groupBy({
      by: ["businessDate"],
      where: { storeId: store.id, businessDate: { gte: from, lte: to }, paidAt: { not: null } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      orderBy: { businessDate: "asc" },
    }),
  ]);

  const revenue = orderAgg._sum.totalAmount ?? 0;
  const orderCount = orderAgg._count._all;
  const avgOrderValue = orderCount > 0 ? Math.round(revenue / orderCount) : 0;
  const refundAmount = refundAgg._sum.refundedAmount ?? 0;

  const productIds = topProducts.map((p) => p.productId);
  const nameRows = productIds.length
    ? await prisma.dailyProductSales.findMany({
        where: { storeId: store.id, productId: { in: productIds }, businessDate: { gte: from, lte: to } },
        select: { productId: true, productNameZh: true },
        orderBy: { businessDate: "desc" },
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
      netQuantity: p._sum.netQuantity ?? 0,
      netAmount: p._sum.netAmount ?? 0,
    })),
    dailyTrend: dailyOrders
      .filter((row): row is typeof row & { businessDate: Date } => row.businessDate !== null)
      .map((row) => ({
        businessDate: row.businessDate,
        orderCount: row._count._all,
        revenue: row._sum.totalAmount ?? 0,
      })),
  };
}
