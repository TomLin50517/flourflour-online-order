import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { order as orderTable, payment as paymentTable } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { fromDbLocale } from "@/lib/i18n/locale-map";
import { maskSensitive } from "@/lib/payment/mask";
import { defaultProviderCode, getPaymentProvider } from "@/lib/payment/registry";
import type { CreateChargeInput, CreateChargeResult, ProviderCode } from "@/lib/payment/types";
import { UnauthorizedOrderAccessError } from "@/server/order/get-order";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

export class OrderNotPayableError extends AppError {
  constructor(status: string) {
    super("CONFLICT", `訂單狀態不允許付款：${status}`, { status });
    this.name = "OrderNotPayableError";
  }
}

export class OrderExpiredError extends AppError {
  constructor() {
    super("ORDER_EXPIRED", "訂單已逾期，請重新下單");
    this.name = "OrderExpiredError";
  }
}

/**
 * 見 SPEC.md §8.2 POST /orders/{orderNo}/payment、附錄 B #1：
 * 金額與品項一律依訂單在 DB 中的快照重算，本函式不接受任何來自前端的價格欄位。
 */
export async function createOrderPayment(input: {
  orderNo: string;
  accessToken: string;
  provider?: ProviderCode;
  returnPath: string;
  clientMeta?: { ip?: string; userAgent?: string };
}): Promise<CreateChargeResult> {
  const db = await getDb();
  const order = await db.query.order.findFirst({
    where: eq(orderTable.orderNo, input.orderNo),
    with: { items: true },
  });
  if (!order) {
    throw new AppError("NOT_FOUND", "訂單不存在");
  }
  if (order.accessToken !== input.accessToken) {
    throw new UnauthorizedOrderAccessError();
  }
  if (order.status !== "PENDING_PAYMENT") {
    throw new OrderNotPayableError(order.status);
  }
  if (order.expiresAt.getTime() <= Date.now()) {
    throw new OrderExpiredError();
  }

  const providerCode = input.provider ?? defaultProviderCode();
  const provider = getPaymentProvider(providerCode);
  const idempotencyKey = randomUUID();

  const chargeInput: CreateChargeInput = {
    orderId: order.id,
    orderNo: order.orderNo,
    amount: order.totalAmount,
    currency: "TWD",
    locale: fromDbLocale(order.locale),
    idempotencyKey,
    items: order.items.map((item) => ({
      name: item.nameSnapshot[order.locale] ?? "",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    customer: {
      name: order.customerName ?? undefined,
      phone: order.customerPhone ?? undefined,
    },
    returnUrl: `${APP_BASE_URL}${input.returnPath}`,
    notifyUrl: `${APP_BASE_URL}/api/v1/payments/webhook/${providerCode}`,
    clientMeta: input.clientMeta,
  };

  const result = await provider.createCharge(chargeInput);

  await db.insert(paymentTable).values({
    orderId: order.id,
    provider: providerCode,
    providerRef: result.providerRef,
    status: "PENDING",
    amount: order.totalAmount,
    currency: order.currency,
    idempotencyKey,
    rawRequest: maskSensitive(chargeInput),
    rawResponse: maskSensitive(result),
  });

  return result;
}
