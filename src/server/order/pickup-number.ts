import type { Prisma } from "@/generated/prisma/client";
import { toBusinessDate } from "./business-date";
import { nextSeq } from "./counter";

export type PickupStoreConfig = {
  id: string;
  timezone: string;
  businessDayCutoff: string;
  pickupPrefix: string;
  pickupPadding: number;
  pickupMax: number;
};

/**
 * 見 SPEC.md §6.3。只能在 PENDING_PAYMENT → PAID 的同一交易內呼叫。
 */
export async function assignPickupNumber(
  tx: Prisma.TransactionClient,
  store: PickupStoreConfig,
  at: Date,
) {
  const businessDate = toBusinessDate(at, store.timezone, store.businessDayCutoff);
  const seq = await nextSeq(tx, "PickupCounter", store.id, businessDate);

  const cycle = Math.floor((seq - 1) / store.pickupMax);
  const inCycle = ((seq - 1) % store.pickupMax) + 1;
  const prefix = String.fromCharCode(store.pickupPrefix.charCodeAt(0) + cycle);
  const pickupNumber = `${prefix}${String(inCycle).padStart(store.pickupPadding, "0")}`;

  return { pickupNumber, businessDate, pickupSeq: seq };
}
