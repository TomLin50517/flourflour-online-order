import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { orThrow } from "@/db/helpers";
import {
  order as orderTable,
  orderItem as orderItemTable,
  orderItemOption as orderItemOptionTable,
  product as productTable,
} from "@/db/schema";
import { getDb } from "@/db/client";

const db = await getDb();
import {
  InvalidOptionSelectionError,
  ProductUnavailableError,
  createOrder,
} from "@/server/order/create-order";
import type { CreateOrderInput } from "@/schemas/order";

afterAll(async () => {
  const orders = await db.query.order.findMany({ where: eq(orderTable.customerNote, "TEST_ORDER") });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    const items = await db.query.orderItem.findMany({
      where: inArray(orderItemTable.orderId, orderIds),
      columns: { id: true },
    });
    const itemIds = items.map((i) => i.id);
    if (itemIds.length > 0) {
      await db.delete(orderItemOptionTable).where(inArray(orderItemOptionTable.orderItemId, itemIds));
    }
    await db.delete(orderItemTable).where(inArray(orderItemTable.orderId, orderIds));
    await db.delete(orderTable).where(inArray(orderTable.id, orderIds));
  }
});

async function getSeededProduct(slug: string) {
  return orThrow(
    await db.query.product.findFirst({
      where: eq(productTable.slug, slug),
      with: {
        optionGroups: { with: { group: { with: { items: true } } } },
      },
    }),
  );
}

describe("createOrder", () => {
  it("recalculates amounts from the DB and snapshots names/options", async () => {
    const product = await getSeededProduct("pineapple-cake");
    const boxSize6 = product.optionGroups[0].group.items.find((i) => i.code === "size6")!;

    const input: CreateOrderInput = {
      locale: "zh-TW",
      items: [{ productId: product.id, quantity: 2, optionItemIds: [boxSize6.id] }],
      note: "TEST_ORDER",
    };

    const { order, isNew } = await createOrder(input, randomUUID());

    expect(isNew).toBe(true);
    expect(order.orderNo).toMatch(/^ORD-\d{8}-\d{4,}$/);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.pickupNumber).toBeNull();

    const expectedUnitPrice = product.basePrice + boxSize6.priceDelta;
    expect(order.items).toHaveLength(1);
    expect(order.items[0].unitPrice).toBe(expectedUnitPrice);
    expect(order.items[0].lineTotal).toBe(expectedUnitPrice * 2);
    expect(order.totalAmount).toBe(expectedUnitPrice * 2);
    expect(order.subtotalAmount).toBe(order.totalAmount);

    const nameSnapshot = order.items[0].nameSnapshot as Record<string, string>;
    expect(nameSnapshot.ZH_TW).toBe("台灣鳳梨酥");
    expect(order.items[0].options).toHaveLength(1);
  });

  it("ignores any client-supplied price and always recalculates from the DB", async () => {
    const product = await getSeededProduct("plain-croissant");

    // 模擬用戶端夾帶價格欄位（createOrder 的型別不接受 price，伺服器本就不會讀取這種欄位）
    const input = {
      locale: "zh-TW",
      items: [{ productId: product.id, quantity: 1, optionItemIds: [] }],
      note: "TEST_ORDER",
      price: 1,
    } as unknown as CreateOrderInput;

    const { order } = await createOrder(input, randomUUID());
    expect(order.totalAmount).toBe(product.basePrice);
  });

  it("returns the same order for a repeated Idempotency-Key", async () => {
    const product = await getSeededProduct("plain-croissant");
    const key = randomUUID();
    const input: CreateOrderInput = {
      locale: "zh-TW",
      items: [{ productId: product.id, quantity: 1, optionItemIds: [] }],
      note: "TEST_ORDER",
    };

    const first = await createOrder(input, key);
    const second = await createOrder(input, key);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.order.orderNo).toBe(first.order.orderNo);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderTable)
      .where(eq(orderTable.idempotencyKey, key));
    expect(count).toBe(1);
  });

  it("rejects a sold-out product with ProductUnavailableError", async () => {
    const product = await getSeededProduct("plain-croissant");
    await db.update(productTable).set({ isSoldOut: true }).where(eq(productTable.id, product.id));

    try {
      const input: CreateOrderInput = {
        locale: "zh-TW",
        items: [{ productId: product.id, quantity: 1, optionItemIds: [] }],
        note: "TEST_ORDER",
      };
      await expect(createOrder(input, randomUUID())).rejects.toThrow(ProductUnavailableError);
    } finally {
      await db.update(productTable).set({ isSoldOut: false }).where(eq(productTable.id, product.id));
    }
  });

  it("rejects a selection that violates a required option group's bounds", async () => {
    const product = await getSeededProduct("pineapple-cake"); // boxSize 為必選 SINGLE

    const input: CreateOrderInput = {
      locale: "zh-TW",
      items: [{ productId: product.id, quantity: 1, optionItemIds: [] }], // 未選 boxSize
      note: "TEST_ORDER",
    };

    await expect(createOrder(input, randomUUID())).rejects.toThrow(InvalidOptionSelectionError);
  });

  it("rejects an option item that doesn't belong to the product", async () => {
    const croissant = await getSeededProduct("plain-croissant");
    const cake = await getSeededProduct("pineapple-cake");
    const foreignOptionId = cake.optionGroups[0].group.items[0].id;

    const input: CreateOrderInput = {
      locale: "zh-TW",
      items: [{ productId: croissant.id, quantity: 1, optionItemIds: [foreignOptionId] }],
      note: "TEST_ORDER",
    };

    await expect(createOrder(input, randomUUID())).rejects.toThrow(InvalidOptionSelectionError);
  });
});
