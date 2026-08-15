import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { idParamsSchema, updateOrderStatusSchema } from "@/schemas/admin";
import { updateOrderStatusAdmin } from "@/server/order/admin-orders";
import { requireAdmin, requireStaff } from "@/server/admin/guard";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/v1/admin/orders/[id]/status">,
) {
  try {
    const { id } = idParamsSchema.parse(await context.params);
    const body = updateOrderStatusSchema.parse(await request.json());

    const session =
      body.toStatus === "REFUNDED" ? await requireAdmin() : await requireStaff();

    const order = await updateOrderStatusAdmin({
      orderId: id,
      toStatus: body.toStatus,
      expectedVersion: body.expectedVersion,
      actorType: body.toStatus === "REFUNDED" ? "ADMIN" : "STAFF",
      actorId: session.user.id,
      note: body.note,
    });

    return NextResponse.json(order);
  } catch (error) {
    return toErrorResponse(error);
  }
}
