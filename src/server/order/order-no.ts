import type { Prisma } from "@/generated/prisma/client";
import { formatBusinessDateCompact, toBusinessDate } from "./business-date";
import { nextSeq } from "./counter";

export type OrderNoStoreConfig = {
  id: string;
  timezone: string;
  businessDayCutoff: string;
};

/**
 * 見 SPEC.md §6.4：ORD-YYYYMMDD-NNNN，建單時（PENDING_PAYMENT）即配發，
 * 與取貨單號各自計數（獨立的 OrderNoCounter）。超過 9999 自然擴展為 5 碼。
 */
export async function assignOrderNo(
  tx: Prisma.TransactionClient,
  store: OrderNoStoreConfig,
  at: Date,
) {
  const businessDate = toBusinessDate(at, store.timezone, store.businessDayCutoff);
  const seq = await nextSeq(tx, "OrderNoCounter", store.id, businessDate);
  const orderNo = `ORD-${formatBusinessDateCompact(businessDate)}-${String(seq).padStart(4, "0")}`;
  return { orderNo, businessDate };
}
