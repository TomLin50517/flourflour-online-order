import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { orderNoParamsSchema, orderTokenHeaderSchema } from "@/schemas/order";
import { getOrderByNo } from "@/server/order/get-order";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/v1/orders/[orderNo]">,
) {
  try {
    const { orderNo } = orderNoParamsSchema.parse(await context.params);
    const accessToken = orderTokenHeaderSchema.parse(request.headers.get("X-Order-Token"));

    const order = await getOrderByNo(orderNo, accessToken);
    return NextResponse.json(order);
  } catch (error) {
    return toErrorResponse(error);
  }
}
