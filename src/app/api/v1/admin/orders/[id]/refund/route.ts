import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { idParamsSchema, refundOrderSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/guard";
import { refundOrder } from "@/server/payment/refund";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/v1/admin/orders/[id]/refund">,
) {
  try {
    const { id } = idParamsSchema.parse(await context.params);
    const body = refundOrderSchema.parse(await request.json());
    const session = await requireAdmin();

    // SPEC §8.3 此端點的 body 只有 { reason }，沒有 expectedVersion——
    // refundOrder() 省略該參數時會直接採用它內部讀到的最新版本。
    const updated = await refundOrder({
      orderId: id,
      reason: body.reason,
      actorId: session.user.id,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
