import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getPaymentProvider } from "@/lib/payment/registry";
import type { ProviderCode } from "@/lib/payment/types";
import { transition } from "@/server/order/state-machine";

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

    return transition({
      tx,
      orderId: order.id,
      expectedVersion: input.expectedVersion,
      toStatus: "REFUNDED",
      actorType: "ADMIN",
      actorId: input.actorId,
      note: input.reason,
    });
  });
}
