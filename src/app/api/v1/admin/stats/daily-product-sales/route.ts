import { NextRequest, NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { formatIsoDate, parseIsoDate } from "@/lib/date";
import { toErrorResponse } from "@/lib/errors";
import { dailyProductSalesQuerySchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/guard";
import { getDailyProductSalesReport } from "@/server/stats/report";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = request.nextUrl;
    const query = dailyProductSalesQuerySchema.parse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      productId: searchParams.get("productId") ?? undefined,
      format: searchParams.get("format") ?? undefined,
    });

    const report = await getDailyProductSalesReport({
      from: parseIsoDate(query.from),
      to: parseIsoDate(query.to),
      productId: query.productId,
    });

    if (query.format === "csv") {
      const csv = toCsv(
        ["商品", "銷售數量", "銷售金額", "退款數量", "淨數量", "淨金額", "佔比(%)"],
        report.items.map((item) => [
          item.productNameZh,
          item.quantitySold,
          item.grossAmount,
          item.refundedQty,
          item.netQuantity,
          item.netAmount,
          item.sharePercent,
        ]),
      );
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="daily-product-sales_${query.from}_${query.to}.csv"`,
        },
      });
    }

    return NextResponse.json({
      from: formatIsoDate(report.from),
      to: formatIsoDate(report.to),
      items: report.items,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
