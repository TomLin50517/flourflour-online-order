import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db/client";
import {
  auditLog,
  dailyProductSales,
  order as orderTable,
  orderEvent,
  orderItem as orderItemTable,
  orderItemOption,
  payment as paymentTable,
  paymentEvent,
} from "../src/db/schema";
import { orThrow } from "../src/db/helpers";

const TEST_NOTE = "PLAYWRIGHT_E2E_TEST";

/**
 * 見 docs/OPEN-QUESTIONS.md：Playwright（tests/e2e/order-flow.spec.ts）本身沒辦法
 * 直接載入資料庫 client 相關的程式碼（ESM/CJS 衝突，此限制在 Prisma 時期即存在，
 * 遷移到 Drizzle 後未重新驗證是否仍然成立，故沿用原本架構），下單流程留下的訂單
 * 改由這支腳本事後清除。建議在 `npm run test:e2e` 之後執行。
 */
async function main() {
  const db = await getDb();
  const orders = await db.query.order.findMany({ where: eq(orderTable.customerNote, TEST_NOTE) });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) {
    console.log("沒有需要清理的 E2E 測試訂單。");
    return;
  }

  const businessDates = [
    ...new Set(orders.map((o) => o.businessDate?.getTime()).filter((t): t is number => t != null)),
  ].map((t) => new Date(t));

  const payments = await db.query.payment.findMany({
    where: inArray(paymentTable.orderId, orderIds),
    columns: { id: true },
  });
  const paymentIds = payments.map((p) => p.id);
  const items = await db.query.orderItem.findMany({
    where: inArray(orderItemTable.orderId, orderIds),
    columns: { id: true },
  });
  const itemIds = items.map((i) => i.id);

  await db.delete(auditLog).where(and(eq(auditLog.targetType, "Order"), inArray(auditLog.targetId, orderIds)));
  if (paymentIds.length > 0) {
    await db.delete(paymentEvent).where(inArray(paymentEvent.paymentId, paymentIds));
  }
  await db.delete(orderEvent).where(inArray(orderEvent.orderId, orderIds));
  await db.delete(paymentTable).where(inArray(paymentTable.orderId, orderIds));
  if (itemIds.length > 0) {
    await db.delete(orderItemOption).where(inArray(orderItemOption.orderItemId, itemIds));
  }
  await db.delete(orderItemTable).where(inArray(orderItemTable.orderId, orderIds));
  await db.delete(orderTable).where(inArray(orderTable.id, orderIds));

  if (businessDates.length > 0) {
    const store = orThrow(await db.query.store.findFirst());
    await db
      .delete(dailyProductSales)
      .where(and(eq(dailyProductSales.storeId, store.id), inArray(dailyProductSales.businessDate, businessDates)));
  }

  console.log(`已清除 ${orderIds.length} 筆 E2E 測試訂單。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
