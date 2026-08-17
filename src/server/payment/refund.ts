import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  order as orderTable,
  orderItem as orderItemTable,
  payment as paymentTable,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { getPaymentProvider } from "@/lib/payment/registry";
import type { ProviderCode } from "@/lib/payment/types";
import { writeAuditLog } from "@/server/admin/audit-log";
import { transition } from "@/server/order/state-machine";
import { applyDailyProductSales } from "@/server/stats/daily-product-sales";

export class NoSuccessfulPaymentError extends AppError {
  constructor() {
    super("CONFLICT", "找不到已成功付款的付款紀錄，無法退款");
    this.name = "NoSuccessfulPaymentError";
  }
}

/**
 * 見 SPEC.md §6.2：REFUNDED 需先呼叫 provider.refund() 成功後才轉移狀態。
 * 真實廠商 adapter 尚未實作時，provider.refund() 會拋出 NotImplementedError（503），
 * 此時函式在寫入任何狀態變更之前就會中止（見 CLAUDE.md 附錄 B #7）。
 *
 * v1 僅支援全額退款（單一 Payment.amount），部分退款留待有實際需求時再設計
 * （見 docs/OPEN-QUESTIONS.md）。
 */
export async function refundOrder(input: {
  orderId: string;
  expectedVersion: number;
  reason: string;
  actorId: string;
}) {
  const db = await getDb();
  const order = await db.query.order.findFirst({ where: eq(orderTable.id, input.orderId) });
  if (!order) {
    throw new AppError("NOT_FOUND", "訂單不存在");
  }
  if (!order.businessDate) {
    // 理論上不會發生：能走到退款代表訂單已 PAID 過，businessDate 必與 pickupNumber 同時配發（INV-6）。
    throw new AppError("INTERNAL_ERROR", "訂單缺少 businessDate，無法更新銷售統計");
  }
  const businessDate = order.businessDate;

  const payment = await db.query.payment.findFirst({
    where: and(eq(paymentTable.orderId, order.id), eq(paymentTable.status, "SUCCEEDED")),
    orderBy: [desc(paymentTable.paidAt)],
  });
  if (!payment || !payment.providerRef) {
    throw new NoSuccessfulPaymentError();
  }

  const provider = getPaymentProvider(payment.provider as ProviderCode);
  const refundResult = await provider.refund({
    providerRef: payment.providerRef,
    amount: payment.amount,
    reason: input.reason,
  });
  if (!refundResult.ok) {
    throw new AppError("CONFLICT", "廠商拒絕此筆退款", { providerRef: payment.providerRef });
  }

  const refunded = await db.transaction(async (tx) => {
    await tx
      .update(paymentTable)
      .set({ status: "REFUNDED", refundedAt: new Date() })
      .where(eq(paymentTable.id, payment.id));

    const result = await transition({
      tx,
      orderId: order.id,
      expectedVersion: input.expectedVersion,
      toStatus: "REFUNDED",
      actorType: "ADMIN",
      actorId: input.actorId,
      note: input.reason,
    });

    // 見 SPEC.md §11：refundedQty/refundedAmount 歸屬於「原始 paidAt 的營業日」，
    // 不是退款當日，所以用 order.businessDate（PAID 當下配發、退款不會改變）。
    const items = await tx.query.orderItem.findMany({ where: eq(orderItemTable.orderId, order.id) });
    await applyDailyProductSales(tx, "REFUNDED", { storeId: order.storeId, businessDate, items });

    return result;
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "order.refund",
    targetType: "Order",
    targetId: order.id,
    diff: { reason: input.reason, providerRef: payment.providerRef },
  });

  return refunded;
}
