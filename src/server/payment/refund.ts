import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getPaymentProvider } from "@/lib/payment/registry";
import type { ProviderCode } from "@/lib/payment/types";
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
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) {
    throw new AppError("NOT_FOUND", "訂單不存在");
  }
  if (!order.businessDate) {
    // 理論上不會發生：能走到退款代表訂單已 PAID 過，businessDate 必與 pickupNumber 同時配發（INV-6）。
    throw new AppError("INTERNAL_ERROR", "訂單缺少 businessDate，無法更新銷售統計");
  }
  const businessDate = order.businessDate;

  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, status: "SUCCEEDED" },
    orderBy: { paidAt: "desc" },
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

  return prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });

    const refunded = await transition({
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
    const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
    await applyDailyProductSales(tx, "REFUNDED", { storeId: order.storeId, businessDate, items });

    return refunded;
  });
}
