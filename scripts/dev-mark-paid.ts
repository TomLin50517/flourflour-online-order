import "dotenv/config";
import { getDb } from "../src/lib/db";
import { assignPickupNumber } from "../src/server/order/pickup-number";
import { transition } from "../src/server/order/state-machine";

const orderNo = process.argv[2];
if (!orderNo) {
  console.error("Usage: tsx scripts/dev-mark-paid.ts <orderNo>");
  process.exit(1);
}

async function main() {
  const prisma = await getDb();
  const store = await prisma.store.findFirstOrThrow();
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNo } });

  const result = await prisma.$transaction(async (tx) => {
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
