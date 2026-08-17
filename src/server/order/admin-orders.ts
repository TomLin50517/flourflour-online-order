import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orThrow } from "@/db/helpers";
import { order as orderTable, type OrderStatus } from "@/db/schema";
import { refundOrder } from "@/server/payment/refund";
import { writeAuditLog } from "@/server/admin/audit-log";
import { transition, type ActorType } from "./state-machine";

export async function listOrdersAdmin(filters: { status?: OrderStatus; pickupNumber?: string }) {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  return db.query.order.findMany({
    where: and(
      eq(orderTable.storeId, store.id),
      filters.status ? eq(orderTable.status, filters.status) : undefined,
      filters.pickupNumber ? eq(orderTable.pickupNumber, filters.pickupNumber) : undefined,
    ),
    orderBy: [desc(orderTable.placedAt)],
    with: { items: true },
  });
}

function buildExtraData(toStatus: OrderStatus, note?: string): Partial<typeof orderTable.$inferInsert> | undefined {
  const now = new Date();
  switch (toStatus) {
    case "READY":
      return { readyAt: now };
    case "COMPLETED":
      return { completedAt: now };
    case "CANCELLED":
      return { cancelledAt: now, cancelReason: note };
    default:
      return undefined;
  }
}

export async function updateOrderStatusAdmin(input: {
  orderId: string;
  toStatus: OrderStatus;
  expectedVersion: number;
  actorType: ActorType;
  actorId: string;
  note?: string;
}) {
  if (input.toStatus === "REFUNDED") {
    // 見 SPEC.md §6.2：REFUNDED 需先呼叫 provider.refund() 成功後才轉移狀態，
    // 委派給 server/payment/refund.ts（與 POST /admin/orders/{id}/refund 共用同一套邏輯）。
    return refundOrder({
      orderId: input.orderId,
      expectedVersion: input.expectedVersion,
      reason: input.note ?? "管理者退款",
      actorId: input.actorId,
    });
  }

  const db = await getDb();
  const order = await db.transaction((tx) =>
    transition({
      tx,
      orderId: input.orderId,
      toStatus: input.toStatus,
      expectedVersion: input.expectedVersion,
      actorType: input.actorType,
      actorId: input.actorId,
      note: input.note,
      extraData: buildExtraData(input.toStatus, input.note),
    }),
  );
  // OrderEvent（見 state-machine.ts）已記錄狀態機層級的細節（from/to/actorType），
  // 這裡另外寫 AuditLog 是為了讓「所有寫入操作」（見 SPEC.md §12.1）能在同一張表
  // 跨實體類型查詢，不用另外去查 OrderEvent。
  await writeAuditLog({
    actorId: input.actorId,
    action: "order.statusChange",
    targetType: "Order",
    targetId: input.orderId,
    diff: { toStatus: input.toStatus, note: input.note },
  });
  return order;
}
