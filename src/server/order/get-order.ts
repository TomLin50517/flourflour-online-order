import { AppError, NotFoundError } from "@/lib/errors";
import { getDb } from "@/db/client";

export class UnauthorizedOrderAccessError extends AppError {
  constructor() {
    super("UNAUTHORIZED", "訂單存取憑證不正確");
    this.name = "UnauthorizedOrderAccessError";
  }
}

export async function getOrderByNo(orderNo: string, accessToken: string) {
  const db = await getDb();
  const order = await db.query.order.findFirst({
    where: (o, { eq }) => eq(o.orderNo, orderNo),
    with: {
      items: { with: { options: true } },
    },
  });

  if (!order) {
    throw new NotFoundError("訂單不存在");
  }
  if (order.accessToken !== accessToken) {
    throw new UnauthorizedOrderAccessError();
  }

  return {
    orderNo: order.orderNo,
    status: order.status,
    pickupNumber: order.pickupNumber,
    totalAmount: order.totalAmount,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    readyAt: order.readyAt,
    expiresAt: order.expiresAt,
    items: order.items.map((item) => {
      const name = item.nameSnapshot[order.locale] ?? "";
      const options = item.options.map((option) => option.itemNameSnapshot[order.locale] ?? "");
      return {
        name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        options,
      };
    }),
  };
}
