import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

/**
 * 見 SPEC.md §12.1：「所有寫入操作記 AuditLog」。刻意做成 fire-and-forget
 * 的獨立寫入（不包進主要操作的交易），理由：
 * 1. 稽核記錄失敗不該讓商品/訂單的正常寫入跟著失敗（AuditLog 只是輔助，不是
 *    業務不變量的一部分，不像 OrderEvent 那樣是狀態機正確性的必要條件）。
 * 2. 大部分呼叫端（商品/分類/規格 CRUD）本身沒有走 `$transaction`，硬要包進去
 *    反而擴大既有函式的職責。
 */
export async function writeAuditLog(params: {
  actorId?: string;
  action: string;
  targetType: string;
  targetId: string;
  diff?: unknown;
}): Promise<void> {
  const prisma = await getDb();
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      diff: params.diff !== undefined ? (params.diff as Prisma.InputJsonValue) : undefined,
    },
  });
}
