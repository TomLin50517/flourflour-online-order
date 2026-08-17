import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { orThrow } from "../src/db/helpers";
import { order as orderTable } from "../src/db/schema";
import { assignPickupNumber } from "../src/server/order/pickup-number";
import { transition } from "../src/server/order/state-machine";

const orderNo = process.argv[2];
if (!orderNo) {
  console.error("Usage: tsx scripts/dev-mark-paid.ts <orderNo>");
  process.exit(1);
}

async function main() {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  const order = orThrow(await db.query.order.findFirst({ where: eq(orderTable.orderNo, orderNo) }));

  const result = await db.transaction(async (tx) => {
    const now = new Date();
    const { pickupNumber, businessDate, pickupSeq } = await assignPickupNumber(tx, store, now);
    return transition({
      tx,
      orderId: order.id,
      expectedVersion: order.version,
      toStatus: "PAID",
      actorType: "PAYMENT_WEBHOOK",
      note: "dev-mark-paid script",
      extraData: { paidAt: now, pickupNumber, businessDate, pickupSeq },
    });
  });

  console.log(`Order ${orderNo} marked PAID, pickupNumber=${result.pickupNumber}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
