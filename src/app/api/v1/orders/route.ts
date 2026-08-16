import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";
import { AppError, toErrorResponse, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { createOrderSchema, idempotencyKeyHeaderSchema } from "@/schemas/order";
import { createOrder } from "@/server/order/create-order";

// 見 SPEC.md §12.1：POST /orders 每 IP 10 次/分。
const ORDER_RATE_LIMIT = 10;
const ORDER_RATE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!checkRateLimit(`orders:${ip}`, ORDER_RATE_LIMIT, ORDER_RATE_WINDOW_MS)) {
      throw new AppError("RATE_LIMITED", "請求過於頻繁，請稍後再試");
    }

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
