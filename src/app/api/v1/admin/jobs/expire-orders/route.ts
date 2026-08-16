import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireStaff } from "@/server/admin/guard";
import { expireOverdueOrders } from "@/server/order/expire-orders";

// 見 docs/OPEN-QUESTIONS.md：本專案無常駐排程器，逾時 job 由外部 cron 定期呼叫此端點觸發。
export async function POST() {
  try {
    await requireStaff();
    const result = await expireOverdueOrders();
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
