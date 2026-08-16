import { NextRequest, NextResponse } from "next/server";
import { formatIsoDate, parseIsoDate } from "@/lib/date";
import { toErrorResponse } from "@/lib/errors";
import { statsSummaryQuerySchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/guard";
import { getStatsSummary } from "@/server/stats/report";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = request.nextUrl;
    const query = statsSummaryQuerySchema.parse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    });

    const summary = await getStatsSummary({
      from: query.from ? parseIsoDate(query.from) : undefined,
      to: query.to ? parseIsoDate(query.to) : undefined,
    });

    return NextResponse.json({
      ...summary,
      from: formatIsoDate(summary.from),
      to: formatIsoDate(summary.to),
      dailyTrend: summary.dailyTrend.map((row) => ({
        ...row,
        businessDate: formatIsoDate(row.businessDate),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
