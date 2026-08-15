import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { adminOrdersQuerySchema } from "@/schemas/admin";
import { listOrdersAdmin } from "@/server/order/admin-orders";
import { requireStaff } from "@/server/admin/guard";

export async function GET(request: NextRequest) {
  try {
    await requireStaff();
    const { searchParams } = request.nextUrl;
    const filters = adminOrdersQuerySchema.parse({
      status: searchParams.get("status") ?? undefined,
      pickupNumber: searchParams.get("pickupNumber") ?? undefined,
    });
    const orders = await listOrdersAdmin(filters);
    return NextResponse.json(orders);
  } catch (error) {
    return toErrorResponse(error);
  }
}
