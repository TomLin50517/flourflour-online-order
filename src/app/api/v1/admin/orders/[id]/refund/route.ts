import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { order as orderTable } from "@/db/schema";
import { AppError, toErrorResponse } from "@/lib/errors";
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

    // SPEC §8.3 此端點的 body 只有 { reason }，沒有 expectedVersion，
    // 故直接讀取當下版本號；樂觀鎖仍由 transition() 內的 updateMany 把關。
    const db = await getDb();
    const order = await db.query.order.findFirst({ where: eq(orderTable.id, id), columns: { version: true } });
    if (!order) {
      throw new AppError("NOT_FOUND", "訂單不存在");
    }

    const updated = await refundOrder({
      orderId: id,
      expectedVersion: order.version,
      reason: body.reason,
      actorId: session.user.id,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
