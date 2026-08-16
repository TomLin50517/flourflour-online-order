import "dotenv/config";
import { prisma } from "@/lib/db";

const TEST_NOTE = "PLAYWRIGHT_E2E_TEST";

/**
 * 見 docs/OPEN-QUESTIONS.md：Playwright（tests/e2e/order-flow.spec.ts）本身沒辦法
 * 直接載入 Prisma（ESM/CJS 衝突），下單流程留下的訂單改由這支腳本事後清除。
 * 建議在 `npm run test:e2e` 之後執行。
 */
async function main() {
  const orders = await prisma.order.findMany({ where: { customerNote: TEST_NOTE } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) {
    console.log("沒有需要清理的 E2E 測試訂單。");
    return;
  }

  const businessDates = [
    ...new Set(orders.map((o) => o.businessDate?.getTime()).filter((t): t is number => t != null)),
  ].map((t) => new Date(t));

  await prisma.auditLog.deleteMany({ where: { targetType: "Order", targetId: { in: orderIds } } });
  await prisma.paymentEvent.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
  await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItemOption.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  if (businessDates.length > 0) {
    const store = await prisma.store.findFirstOrThrow();
    await prisma.dailyProductSales.deleteMany({
      where: { storeId: store.id, businessDate: { in: businessDates } },
    });
  }

  console.log(`已清除 ${orderIds.length} 筆 E2E 測試訂單。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
