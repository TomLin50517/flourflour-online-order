import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ConflictError, InvalidStateTransitionError, transition } from "./state-machine";

const TIMEOUT_CANCEL_REASON = "未於時限內完成付款";
const ALERT_WINDOW_MS = 60 * 60 * 1000; // 近一小時
const ALERT_MIN_SAMPLE = 5; // 樣本太小時比例沒有統計意義，不告警
const ALERT_THRESHOLD = 0.2;

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
          note: TIMEOUT_CANCEL_REASON,
          extraData: { cancelledAt: now, cancelReason: TIMEOUT_CANCEL_REASON },
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

  // 見 SPEC.md §12.3：PENDING_PAYMENT 逾時率 > 20% 需要告警。以「近一小時內下的
  // 訂單」為樣本，比較其中最終因逾時被取消的比例；樣本數太小（< 5）時比例沒有
  // 統計意義，不告警，避免深夜低流量時段誤報。
  const windowStart = new Date(now.getTime() - ALERT_WINDOW_MS);
  const [totalPlaced, totalTimedOut] = await Promise.all([
    prisma.order.count({ where: { placedAt: { gte: windowStart, lte: now } } }),
    prisma.order.count({
      where: {
        placedAt: { gte: windowStart, lte: now },
        status: "CANCELLED",
        cancelReason: TIMEOUT_CANCEL_REASON,
      },
    }),
  ]);
  if (totalPlaced >= ALERT_MIN_SAMPLE) {
    const timeoutRate = totalTimedOut / totalPlaced;
    if (timeoutRate > ALERT_THRESHOLD) {
      logger.alert("PENDING_PAYMENT timeout rate exceeded 20%", {
        timeoutRatePercent: Math.round(timeoutRate * 1000) / 10,
        totalPlaced,
        totalTimedOut,
        windowMinutes: ALERT_WINDOW_MS / 60_000,
      });
    }
  }

  return { scanned: overdue.length, cancelled, skipped };
}
