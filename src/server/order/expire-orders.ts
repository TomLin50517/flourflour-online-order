import { prisma } from "@/lib/db";
import { ConflictError, InvalidStateTransitionError, transition } from "./state-machine";

/**
 * 見 SPEC.md §7.5、§13 M4：逾時 job。掃描 expiresAt 已過的 PENDING_PAYMENT 訂單並轉為 CANCELLED。
 * 使用 @@index([status, expiresAt])（見 SPEC.md §5.1）加速掃描。
 * 觸發方式見 docs/OPEN-QUESTIONS.md（本專案無常駐排程器，改由外部 cron 呼叫 admin job 端點）。
 */
export async function expireOverdueOrders(now: Date = new Date()) {
  const overdue = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } },
    select: { id: true, version: true },
  });

  let cancelled = 0;
  let skipped = 0;

  for (const order of overdue) {
    try {
      await prisma.$transaction((tx) =>
        transition({
          tx,
          orderId: order.id,
          expectedVersion: order.version,
          toStatus: "CANCELLED",
          actorType: "SYSTEM",
          note: "未於時限內完成付款",
          extraData: { cancelledAt: now, cancelReason: "未於時限內完成付款" },
        }),
      );
      cancelled += 1;
    } catch (error) {
      if (error instanceof ConflictError || error instanceof InvalidStateTransitionError) {
        // 掃描之後、轉移之前這筆訂單已被其他流程處理完（例如剛好付款成功），略過即可。
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return { scanned: overdue.length, cancelled, skipped };
}
