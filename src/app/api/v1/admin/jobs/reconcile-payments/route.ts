import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireAdmin } from "@/server/admin/guard";
import { reconcilePendingPayments } from "@/server/payment/reconcile";

// 見 docs/OPEN-QUESTIONS.md：本專案無常駐排程器，對帳 job 由外部 cron 每 5 分鐘呼叫此端點觸發。
export async function POST() {
  try {
    await requireAdmin();
    const result = await reconcilePendingPayments();
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
