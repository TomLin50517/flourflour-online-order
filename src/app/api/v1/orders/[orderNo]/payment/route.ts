import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { orderNoParamsSchema, orderTokenHeaderSchema } from "@/schemas/order";
import { createOrderPaymentSchema } from "@/schemas/payment";
import { createOrderPayment } from "@/server/payment/create-charge";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/v1/orders/[orderNo]/payment">,
) {
  try {
    const { orderNo } = orderNoParamsSchema.parse(await context.params);
    const accessToken = orderTokenHeaderSchema.parse(request.headers.get("X-Order-Token"));

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new ValidationError("請求內容不是有效的 JSON");
    }
    const body = createOrderPaymentSchema.parse(json);

    const result = await createOrderPayment({
      orderNo,
      accessToken,
      provider: body.provider,
      returnPath: body.returnPath,
      clientMeta: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
