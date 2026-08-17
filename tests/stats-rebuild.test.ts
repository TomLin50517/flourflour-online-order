import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { orThrow } from "@/db/helpers";
import {
  auditLog as auditLogTable,
  dailyProductSales,
  order as orderTable,
  orderEvent as orderEventTable,
  orderItem as orderItemTable,
  orderItemOption as orderItemOptionTable,
  payment as paymentTable,
  paymentEvent as paymentEventTable,
  product as productTable,
} from "@/db/schema";
import { getDb } from "@/db/client";

const db = await getDb();
import { signMockPayload } from "@/lib/payment/providers/mock";
import type { RawWebhook } from "@/lib/payment/types";
import type { CreateOrderInput } from "@/schemas/order";
import { createOrder } from "@/server/order/create-order";
import { createOrderPayment } from "@/server/payment/create-charge";
import { refundOrder } from "@/server/payment/refund";
import { handlePaymentWebhook } from "@/server/payment/webhook";
import { rebuildDailyProductSales } from "@/server/stats/rebuild";

// 見 SPEC.md §11「一致性檢查」與 §13 M5 驗收條件：造若干筆含退款的訂單，
// 走「真實」的 建單 → 付款 → (部分)退款 流程，驗證即時累加的數字與手算一致，
// 再對同一區間跑 rebuild，驗證重算結果與即時累加完全一致。
// 用固定的合成日期（2026-01-10 / 2026-01-11）而非「今日」，避免與其他平行執行
// 的測試檔共用同一天而互相干擾。
const DAY1 = new Date(Date.UTC(2026, 0, 10, 6, 0, 0)); // Asia/Taipei 14:00 → businessDate 2026-01-10
const DAY2 = new Date(Date.UTC(2026, 0, 11, 6, 0, 0)); // → businessDate 2026-01-11
const TEST_NOTE = "M5TEST_STATS_REBUILD";

async function getProduct(slug: string) {
  return orThrow(await db.query.product.findFirst({ where: eq(productTable.slug, slug) }));
}

function buildWebhookRaw(payload: unknown): RawWebhook {
  const rawBody = JSON.stringify(payload);
  return { headers: { "x-mock-signature": signMockPayload(rawBody) }, rawBody, query: {} };
}

async function createAndPay(productId: string, quantity: number, paidAt: Date) {
  const input: CreateOrderInput = {
    locale: "zh-TW",
    items: [{ productId, quantity, optionItemIds: [] }],
    note: TEST_NOTE,
  };
  const { order } = await createOrder(input, randomUUID());
  await createOrderPayment({ orderNo: order.orderNo, accessToken: order.accessToken, returnPath: "/test" });

  const outcome = await handlePaymentWebhook(
    "mock",
    buildWebhookRaw({
      providerEventId: randomUUID(),
      paymentId: randomUUID(),
      orderNo: order.orderNo,
      amount: order.totalAmount,
      currency: "TWD",
      eventType: "charge.succeeded",
      paidAt: paidAt.toISOString(),
    }),
  );
  if (outcome !== "PROCESSED") {
    throw new Error(`unexpected webhook outcome: ${outcome}`);
  }
  return order;
}

async function getDailyProductSalesRow(storeId: string, businessDate: Date, productId: string) {
  return orThrow(
    await db.query.dailyProductSales.findFirst({
      where: and(
        eq(dailyProductSales.storeId, storeId),
        eq(dailyProductSales.businessDate, businessDate),
        eq(dailyProductSales.productId, productId),
      ),
    }),
  );
}

// 用 customerNote 標記回查做清理（而非只靠測試內累積的 id 陣列）：如果某次執行
// 中途丟出例外，還沒記錄下來的訂單就永遠不會被清掉，殘留資料會讓下一次 rebuild
// 掃描到不該存在的訂單。用標記回查可以連前一次失敗殘留的髒資料一起清乾淨，
// 是自我修復的（同一構想見 create-order.test.ts 的 customerNote: "TEST_ORDER"）。
afterEach(async () => {
  const orders = await db.query.order.findMany({ where: eq(orderTable.customerNote, TEST_NOTE) });
  const orderIds = orders.map((o) => o.id);
  const businessDates = [
    ...new Set(orders.map((o) => o.businessDate?.getTime()).filter((t): t is number => t != null)),
  ].map((t) => new Date(t));

  if (orderIds.length > 0) {
    const payments = await db.query.payment.findMany({
      where: inArray(paymentTable.orderId, orderIds),
      columns: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);
    if (paymentIds.length > 0) {
      await db.delete(paymentEventTable).where(inArray(paymentEventTable.paymentId, paymentIds));
    }
    const items = await db.query.orderItem.findMany({
      where: inArray(orderItemTable.orderId, orderIds),
      columns: { id: true },
    });
    const itemIds = items.map((i) => i.id);

    await db.delete(orderEventTable).where(inArray(orderEventTable.orderId, orderIds));
    await db.delete(auditLogTable).where(and(eq(auditLogTable.targetType, "Order"), inArray(auditLogTable.targetId, orderIds)));
    await db.delete(paymentTable).where(inArray(paymentTable.orderId, orderIds));
    if (itemIds.length > 0) {
      await db.delete(orderItemOptionTable).where(inArray(orderItemOptionTable.orderItemId, itemIds));
    }
    await db.delete(orderItemTable).where(inArray(orderItemTable.orderId, orderIds));
    await db.delete(orderTable).where(inArray(orderTable.id, orderIds));
  }

  if (businessDates.length > 0) {
    const store = orThrow(await db.query.store.findFirst());
    await db
      .delete(dailyProductSales)
      .where(and(eq(dailyProductSales.storeId, store.id), inArray(dailyProductSales.businessDate, businessDates)));
  }
});

describe("stats:rebuild consistency", () => {
  it("rebuild matches live-accumulated DailyProductSales after several paid + one refunded order", async () => {
    // 用 lemon-croissant 而非 plain-croissant：create-order.test.ts 會暫時把
    // plain-croissant 切成 isSoldOut 來測試錯誤情境，平行執行測試檔時兩者共用
    // plain-croissant 會有競態風險。
    const product = await getProduct("lemon-croissant"); // basePrice 135，addon 規格 minSelect=0（不選也合法）
    const store = orThrow(await db.query.store.findFirst());

    await createAndPay(product.id, 2, DAY1); // day1，保留
    const orderB = await createAndPay(product.id, 3, DAY1); // day1，稍後退款
    await createAndPay(product.id, 1, DAY2); // day2，保留

    // 第四筆刻意不付款：驗證 PENDING_PAYMENT 完全不計入統計。
    await createOrder(
      {
        locale: "zh-TW",
        items: [{ productId: product.id, quantity: 1, optionItemIds: [] }],
        note: TEST_NOTE,
      },
      randomUUID(),
    );

    const freshB = orThrow(await db.query.order.findFirst({ where: eq(orderTable.id, orderB.id) }));
    await refundOrder({
      orderId: orderB.id,
      expectedVersion: freshB.version,
      reason: "M5TEST 退款",
      actorId: "M5TEST-ADMIN",
    });

    // 手算（basePrice 135）：day1 = (qty2 + qty3) 付款、qty3 退款
    //             → quantitySold=5 grossAmount=675 refundedQty=3 refundedAmount=405 → net=2 / 270
    //       day2 = qty1 付款 → quantitySold=1 grossAmount=135 net=1 / 135
    const liveDay1 = await getDailyProductSalesRow(store.id, DAY1_KEY(), product.id);
    expect(liveDay1).toMatchObject({
      quantitySold: 5,
      grossAmount: 675,
      refundedQty: 3,
      refundedAmount: 405,
      netQuantity: 2,
      netAmount: 270,
    });

    const liveDay2 = await getDailyProductSalesRow(store.id, DAY2_KEY(), product.id);
    expect(liveDay2).toMatchObject({
      quantitySold: 1,
      grossAmount: 135,
      refundedQty: 0,
      refundedAmount: 0,
      netQuantity: 1,
      netAmount: 135,
    });

    const rebuildResult = await rebuildDailyProductSales({ from: DAY1, to: DAY2 });
    expect(rebuildResult.ordersConsidered).toBe(3); // A, B, C（D 從未付款，不列入）

    const rebuiltDay1 = await getDailyProductSalesRow(store.id, DAY1_KEY(), product.id);
    const rebuiltDay2 = await getDailyProductSalesRow(store.id, DAY2_KEY(), product.id);

    expect(rebuiltDay1).toMatchObject({
      quantitySold: liveDay1.quantitySold,
      grossAmount: liveDay1.grossAmount,
      refundedQty: liveDay1.refundedQty,
      refundedAmount: liveDay1.refundedAmount,
      netQuantity: liveDay1.netQuantity,
      netAmount: liveDay1.netAmount,
    });
    expect(rebuiltDay2).toMatchObject({
      quantitySold: liveDay2.quantitySold,
      grossAmount: liveDay2.grossAmount,
      netQuantity: liveDay2.netQuantity,
      netAmount: liveDay2.netAmount,
    });
  });
});

// businessDate 儲存為 UTC 午夜（見 toBusinessDate），DAY1/DAY2 常數本身帶時分秒，
// 這兩個 helper 換算成同一個 UTC 午夜供查詢用。
function DAY1_KEY() {
  return new Date(Date.UTC(2026, 0, 10));
}
function DAY2_KEY() {
  return new Date(Date.UTC(2026, 0, 11));
}
