import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { orThrow } from "@/db/helpers";
import { order as orderTable, orderEvent, type OrderStatus } from "@/db/schema";
import { getDb } from "@/db/client";

const db = await getDb();
import {
  ConflictError,
  InvalidStateTransitionError,
  transition,
  type ActorType,
} from "@/server/order/state-machine";

async function createTestOrder(status: OrderStatus) {
  const store = orThrow(await db.query.store.findFirst());
  const [row] = await db
    .insert(orderTable)
    .values({
      storeId: store.id,
      orderNo: `TEST-${randomUUID()}`,
      accessToken: randomUUID(),
      idempotencyKey: randomUUID(),
      status,
      locale: "ZH_TW",
      subtotalAmount: 100,
      totalAmount: 100,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    .returning();
  return orThrow(row);
}

afterEach(async () => {
  const testOrders = await db.query.order.findMany({
    where: like(orderTable.orderNo, "TEST-%"),
    columns: { id: true },
  });
  const testOrderIds = testOrders.map((o) => o.id);
  if (testOrderIds.length > 0) {
    await db.delete(orderEvent).where(inArray(orderEvent.orderId, testOrderIds));
    await db.delete(orderTable).where(inArray(orderTable.id, testOrderIds));
  }
});

const LEGAL_CASES: Array<[OrderStatus, OrderStatus, ActorType]> = [
  ["PENDING_PAYMENT", "PAID", "PAYMENT_WEBHOOK"],
  ["PENDING_PAYMENT", "CANCELLED", "STAFF"],
  ["PENDING_PAYMENT", "CANCELLED", "SYSTEM"],
  ["PAID", "PREPARING", "STAFF"],
  ["PREPARING", "READY", "STAFF"],
  ["READY", "COMPLETED", "STAFF"],
  ["PAID", "REFUNDED", "ADMIN"],
  ["PREPARING", "REFUNDED", "ADMIN"],
  ["READY", "REFUNDED", "ADMIN"],
  ["COMPLETED", "REFUNDED", "ADMIN"],
];

const ILLEGAL_CASES: Array<[OrderStatus, OrderStatus, ActorType]> = [
  ["PENDING_PAYMENT", "PREPARING", "STAFF"],
  ["PENDING_PAYMENT", "READY", "STAFF"],
  ["PENDING_PAYMENT", "COMPLETED", "STAFF"],
  ["PENDING_PAYMENT", "PAID", "STAFF"], // 錯誤的 actorType
  ["PAID", "READY", "STAFF"], // 跳過 PREPARING
  ["PAID", "COMPLETED", "STAFF"],
  ["PAID", "CANCELLED", "STAFF"],
  ["PREPARING", "COMPLETED", "STAFF"], // 跳過 READY
  ["PREPARING", "PAID", "PAYMENT_WEBHOOK"],
  ["CANCELLED", "PAID", "PAYMENT_WEBHOOK"],
  ["CANCELLED", "PENDING_PAYMENT", "SYSTEM"],
  ["COMPLETED", "PREPARING", "STAFF"],
  ["COMPLETED", "READY", "STAFF"],
  ["REFUNDED", "PAID", "PAYMENT_WEBHOOK"],
  ["PAID", "PAID", "STAFF"],
];

describe("transition — legal transitions", () => {
  it.each(LEGAL_CASES)("allows %s -> %s (%s)", async (from, to, actorType) => {
    const order = await createTestOrder(from);

    const updated = await db.transaction((tx) =>
      transition({ tx, orderId: order.id, expectedVersion: order.version, toStatus: to, actorType }),
    );

    expect(updated.status).toBe(to);
    expect(updated.version).toBe(order.version + 1);

    const events = await db.query.orderEvent.findMany({ where: eq(orderEvent.orderId, order.id) });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: from, toStatus: to, actorType });
  });
});

describe("transition — illegal transitions are rejected", () => {
  it.each(ILLEGAL_CASES)("rejects %s -> %s (%s)", async (from, to, actorType) => {
    const order = await createTestOrder(from);

    await expect(
      db.transaction((tx) =>
        transition({ tx, orderId: order.id, expectedVersion: order.version, toStatus: to, actorType }),
      ),
    ).rejects.toThrow(InvalidStateTransitionError);

    const reloaded = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, order.id) }));
    expect(reloaded.status).toBe(from);
    expect(reloaded.version).toBe(order.version);
    const events = await db.query.orderEvent.findMany({ where: eq(orderEvent.orderId, order.id) });
    expect(events).toHaveLength(0);
  });
});

describe("transition — optimistic locking", () => {
  it("rejects a stale expectedVersion with ConflictError", async () => {
    const order = await createTestOrder("PAID");

    await db.transaction((tx) =>
      transition({
        tx,
        orderId: order.id,
        expectedVersion: order.version,
        toStatus: "PREPARING",
        actorType: "STAFF",
      }),
    );

    await expect(
      db.transaction((tx) =>
        transition({
          tx,
          orderId: order.id,
          expectedVersion: order.version, // 已過期的舊版本
          toStatus: "PREPARING",
          actorType: "STAFF",
        }),
      ),
    ).rejects.toThrow(ConflictError);
  });
});
