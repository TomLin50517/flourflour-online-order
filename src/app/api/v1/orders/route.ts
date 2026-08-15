import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { createOrderSchema, idempotencyKeyHeaderSchema } from "@/schemas/order";
import { createOrder } from "@/server/order/create-order";

export async function POST(request: NextRequest) {
  try {
    const idempotencyKeyHeader = request.headers.get("Idempotency-Key");
    const idempotencyKey = idempotencyKeyHeaderSchema.parse(idempotencyKeyHeader);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new ValidationError("請求內容不是有效的 JSON");
    }
    const body = createOrderSchema.parse(json);

    const { order, isNew } = await createOrder(body, idempotencyKey);
    const locale = order.locale;

    return NextResponse.json(
      {
        orderNo: order.orderNo,
        accessToken: order.accessToken,
        totalAmount: order.totalAmount,
        currency: order.currency,
        expiresAt: order.expiresAt,
        items: order.items.map((item) => ({
          name: (item.nameSnapshot as Record<string, string>)[locale] ?? "",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
      },
      { status: isNew ? 201 : 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
