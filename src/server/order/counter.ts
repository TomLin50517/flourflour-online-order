import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type CounterTable = "PickupCounter" | "OrderNoCounter";

/**
 * 見 SPEC.md §6.3/§6.4：原子 UPSERT 遞增序號，避免併發重號。
 * `table` 僅接受固定字面量（非使用者輸入），故用 `sql.identifier` 動態代入表名是安全的
 * （見 docs/DRIZZLE-MIGRATION-SPEC.md §4.5：保留原始 SQL 寫法，跟 Prisma 版本邏輯一致，
 * 這是全系統併發正確性的地基，不為了「更 Drizzle 原生」增加改寫風險）。
 */
export async function nextSeq(
  tx: Tx,
  table: CounterTable,
  storeId: string,
  businessDate: Date,
): Promise<number> {
  const t = sql.identifier(table);
  const result = await tx.execute<{ lastSeq: number }>(sql`
    INSERT INTO ${t} ("storeId","businessDate","lastSeq","updatedAt")
    VALUES (${storeId}, ${businessDate}, 1, NOW())
    ON CONFLICT ("storeId","businessDate")
    DO UPDATE SET "lastSeq" = ${t}."lastSeq" + 1, "updatedAt" = NOW()
    RETURNING "lastSeq"
  `);
  return result.rows[0].lastSeq;
}
