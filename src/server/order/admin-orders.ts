import type { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { refundOrder } from "@/server/payment/refund";
import { transition, type ActorType } from "./state-machine";

export async function listOrdersAdmin(filters: { status?: OrderStatus; pickupNumber?: string }) {
  const store = await prisma.store.findFirstOrThrow();
  return prisma.order.findMany({
    where: {
      storeId: store.id,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.pickupNumber ? { pickupNumber: filters.pickupNumber } : {}),
    },
    orderBy: { placedAt: "desc" },
    include: { items: true },
  });
}

function buildExtraData(toStatus: OrderStatus, note?: string) {
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

  return prisma.$transaction((tx) =>
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
}
