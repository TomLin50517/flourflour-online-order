import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

const prisma = await getDb();
import { applyDailyProductSales } from "@/server/stats/daily-product-sales";

// 用完全合成的 storeId/productId（DailyProductSales 對兩者皆無外鍵約束），
// 純粹測試 upsert 累加邏輯本身，不牽涉真實商品/訂單。
const STORE_ID_PREFIX = "M5TEST-STORE-";

function makeParams(overrides: Partial<{ storeId: string; businessDate: Date; productId: string }> = {}) {
  return {
    storeId: overrides.storeId ?? `${STORE_ID_PREFIX}${randomUUID()}`,
    businessDate: overrides.businessDate ?? new Date("2026-08-16T00:00:00.000Z"),
    productId: overrides.productId ?? `M5TEST-PRODUCT-${randomUUID()}`,
  };
}

afterEach(async () => {
  await prisma.dailyProductSales.deleteMany({ where: { storeId: { startsWith: STORE_ID_PREFIX } } });
});

describe("applyDailyProductSales", () => {
  it("creates a row on the first PAID event", async () => {
    const { storeId, businessDate, productId } = makeParams();

    await prisma.$transaction((tx) =>
      applyDailyProductSales(tx, "PAID", {
        storeId,
        businessDate,
        items: [{ productId, quantity: 2, lineTotal: 160, nameSnapshot: { ZH_TW: "測試可頌" } }],
      }),
    );

    const row = await prisma.dailyProductSales.findUniqueOrThrow({
      where: { storeId_businessDate_productId: { storeId, businessDate, productId } },
    });
    expect(row).toMatchObject({
      productNameZh: "測試可頌",
      quantitySold: 2,
      grossAmount: 160,
      refundedQty: 0,
      refundedAmount: 0,
      netQuantity: 2,
      netAmount: 160,
    });
  });

  it("accumulates across multiple PAID events for the same product/day", async () => {
    const { storeId, businessDate, productId } = makeParams();
    const items = [{ productId, quantity: 1, lineTotal: 80, nameSnapshot: { ZH_TW: "測試可頌" } }];

    await prisma.$transaction((tx) => applyDailyProductSales(tx, "PAID", { storeId, businessDate, items }));
    await prisma.$transaction((tx) => applyDailyProductSales(tx, "PAID", { storeId, businessDate, items }));

    const row = await prisma.dailyProductSales.findUniqueOrThrow({
      where: { storeId_businessDate_productId: { storeId, businessDate, productId } },
    });
    expect(row.quantitySold).toBe(2);
    expect(row.grossAmount).toBe(160);
    expect(row.netQuantity).toBe(2);
    expect(row.netAmount).toBe(160);
  });

  it("REFUNDED increases refundedQty/refundedAmount and decreases net without touching quantitySold/grossAmount", async () => {
    const { storeId, businessDate, productId } = makeParams();
    const items = [{ productId, quantity: 3, lineTotal: 240, nameSnapshot: { ZH_TW: "測試可頌" } }];

    await prisma.$transaction((tx) => applyDailyProductSales(tx, "PAID", { storeId, businessDate, items }));
    await prisma.$transaction((tx) => applyDailyProductSales(tx, "REFUNDED", { storeId, businessDate, items }));

    const row = await prisma.dailyProductSales.findUniqueOrThrow({
      where: { storeId_businessDate_productId: { storeId, businessDate, productId } },
    });
    expect(row.quantitySold).toBe(3);
    expect(row.grossAmount).toBe(240);
    expect(row.refundedQty).toBe(3);
    expect(row.refundedAmount).toBe(240);
    expect(row.netQuantity).toBe(0);
    expect(row.netAmount).toBe(0);
  });

  it("keeps separate rows per productId within the same store/day", async () => {
    const shared = makeParams();
    const otherProductId = `M5TEST-PRODUCT-${randomUUID()}`;

    await prisma.$transaction((tx) =>
      applyDailyProductSales(tx, "PAID", {
        storeId: shared.storeId,
        businessDate: shared.businessDate,
        items: [
          { productId: shared.productId, quantity: 1, lineTotal: 80, nameSnapshot: { ZH_TW: "A" } },
          { productId: otherProductId, quantity: 5, lineTotal: 675, nameSnapshot: { ZH_TW: "B" } },
        ],
      }),
    );

    const rowA = await prisma.dailyProductSales.findUniqueOrThrow({
      where: {
        storeId_businessDate_productId: {
          storeId: shared.storeId,
          businessDate: shared.businessDate,
          productId: shared.productId,
        },
      },
    });
    const rowB = await prisma.dailyProductSales.findUniqueOrThrow({
      where: {
        storeId_businessDate_productId: {
          storeId: shared.storeId,
          businessDate: shared.businessDate,
          productId: otherProductId,
        },
      },
    });
    expect(rowA.quantitySold).toBe(1);
    expect(rowB.quantitySold).toBe(5);
    expect(rowB.grossAmount).toBe(675);
  });
});
