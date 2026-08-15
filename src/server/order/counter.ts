import type { Prisma } from "@/generated/prisma/client";

export type CounterTable = "PickupCounter" | "OrderNoCounter";

/**
 * 見 SPEC.md §6.3/§6.4：原子 UPSERT 遞增序號，避免併發重號。
 * `table` 僅接受固定字面量（非使用者輸入），故用 $queryRawUnsafe 動態代入表名是安全的。
 */
export async function nextSeq(
  tx: Prisma.TransactionClient,
  table: CounterTable,
  storeId: string,
  businessDate: Date,
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ lastSeq: number }[]>(
    `INSERT INTO "${table}" ("storeId","businessDate","lastSeq","updatedAt")
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT ("storeId","businessDate")
     DO UPDATE SET "lastSeq" = "${table}"."lastSeq" + 1, "updatedAt" = NOW()
     RETURNING "lastSeq"`,
    storeId,
    businessDate,
  );
  return rows[0].lastSeq;
}
