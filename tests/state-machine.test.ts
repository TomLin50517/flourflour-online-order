import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import {
  ConflictError,
  InvalidStateTransitionError,
  transition,
  type ActorType,
} from "@/server/order/state-machine";

async function createTestOrder(status: OrderStatus) {
  const store = await prisma.store.findFirstOrThrow();
  return prisma.order.create({
    data: {
      storeId: store.id,
      orderNo: `TEST-${randomUUID()}`,
      accessToken: randomUUID(),
      idempotencyKey: randomUUID(),
      status,
      locale: "ZH_TW",
      subtotalAmount: 100,
      totalAmount: 100,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

afterEach(async () => {
  await prisma.orderEvent.deleteMany({ where: { order: { orderNo: { startsWith: "TEST-" } } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: "TEST-" } } });
});

const LEGAL_CASES: Array<[OrderStatus, OrderStatus, ActorType]> = [
  [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, "PAYMENT_WEBHOOK"],
  [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED, "STAFF"],
  [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED, "SYSTEM"],
  [OrderStatus.PAID, OrderStatus.PREPARING, "STAFF"],
  [OrderStatus.PREPARING, OrderStatus.READY, "STAFF"],
  [OrderStatus.READY, OrderStatus.COMPLETED, "STAFF"],
  [OrderStatus.PAID, OrderStatus.REFUNDED, "ADMIN"],
  [OrderStatus.PREPARING, OrderStatus.REFUNDED, "ADMIN"],
  [OrderStatus.READY, OrderStatus.REFUNDED, "ADMIN"],
  [OrderStatus.COMPLETED, OrderStatus.REFUNDED, "ADMIN"],
];

const ILLEGAL_CASES: Array<[OrderStatus, OrderStatus, ActorType]> = [
  [OrderStatus.PENDING_PAYMENT, OrderStatus.PREPARING, "STAFF"],
  [OrderStatus.PENDING_PAYMENT, OrderStatus.READY, "STAFF"],
  [OrderStatus.PENDING_PAYMENT, OrderStatus.COMPLETED, "STAFF"],
  [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, "STAFF"], // 錯誤的 actorType
  [OrderStatus.PAID, OrderStatus.READY, "STAFF"], // 跳過 PREPARING
  [OrderStatus.PAID, OrderStatus.COMPLETED, "STAFF"],
  [OrderStatus.PAID, OrderStatus.CANCELLED, "STAFF"],
  [OrderStatus.PREPARING, OrderStatus.COMPLETED, "STAFF"], // 跳過 READY
  [OrderStatus.PREPARING, OrderStatus.PAID, "PAYMENT_WEBHOOK"],
  [OrderStatus.CANCELLED, OrderStatus.PAID, "PAYMENT_WEBHOOK"],
  [OrderStatus.CANCELLED, OrderStatus.PENDING_PAYMENT, "SYSTEM"],
  [OrderStatus.COMPLETED, OrderStatus.PREPARING, "STAFF"],
  [OrderStatus.COMPLETED, OrderStatus.READY, "STAFF"],
  [OrderStatus.REFUNDED, OrderStatus.PAID, "PAYMENT_WEBHOOK"],
  [OrderStatus.PAID, OrderStatus.PAID, "STAFF"],
];

describe("transition — legal transitions", () => {
  it.each(LEGAL_CASES)("allows %s -> %s (%s)", async (from, to, actorType) => {
    const order = await createTestOrder(from);

    const updated = await prisma.$transaction((tx) =>
      transition({ tx, orderId: order.id, expectedVersion: order.version, toStatus: to, actorType }),
    );

    expect(updated.status).toBe(to);
    expect(updated.version).toBe(order.version + 1);

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: from, toStatus: to, actorType });
  });
});

describe("transition — illegal transitions are rejected", () => {
  it.each(ILLEGAL_CASES)("rejects %s -> %s (%s)", async (from, to, actorType) => {
    const order = await createTestOrder(from);

    await expect(
      prisma.$transaction((tx) =>
        transition({ tx, orderId: order.id, expectedVersion: order.version, toStatus: to, actorType }),
      ),
    ).rejects.toThrow(InvalidStateTransitionError);

    const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.status).toBe(from);
    expect(reloaded.version).toBe(order.version);
    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(0);
  });
});

describe("transition — optimistic locking", () => {
  it("rejects a stale expectedVersion with ConflictError", async () => {
    const order = await createTestOrder(OrderStatus.PAID);

    await prisma.$transaction((tx) =>
      transition({
        tx,
        orderId: order.id,
        expectedVersion: order.version,
        toStatus: OrderStatus.PREPARING,
        actorType: "STAFF",
      }),
    );

    await expect(
      prisma.$transaction((tx) =>
        transition({
          tx,
          orderId: order.id,
          expectedVersion: order.version, // 已過期的舊版本
          toStatus: OrderStatus.PREPARING,
          actorType: "STAFF",
        }),
      ),
    ).rejects.toThrow(ConflictError);
  });
});
