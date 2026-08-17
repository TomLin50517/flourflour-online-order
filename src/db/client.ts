import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { cache } from "react";
import * as schema from "./schema";

// 見 docs/DRIZZLE-MIGRATION-SPEC.md §5.1：全專案唯一的資料庫連線入口。
const globalForDrizzle = globalThis as unknown as {
  pgPoolSingleton: Pool | undefined;
};

/**
 * Cloudflare Workers runtime 會把 `navigator.userAgent` 固定設為
 * `"Cloudflare-Workers"`，本機環境不會。
 */
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/**
 * Workers 上每請求建立新連線（`max: 1`），本機 Node.js 維持 module-level 單例。
 */
export const getDb = cache(async () => {
  if (isCloudflareWorkersRuntime()) {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
    return drizzle(pool, { schema });
  }

  if (!globalForDrizzle.pgPoolSingleton) {
    globalForDrizzle.pgPoolSingleton = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return drizzle(globalForDrizzle.pgPoolSingleton, { schema });
});

// 見 docs/DRIZZLE-MIGRATION-SPEC.md §4.4/§4.5：取代 Prisma 的 `Prisma.TransactionClient`——
// 交易內的 `tx` 跟一般的 `db` 介面一致，用型別推導取得，避免手動組合 Drizzle 內部的
// 泛型型別名稱（對 Drizzle 版本升級較不脆弱）。
type DbClient = Awaited<ReturnType<typeof getDb>>;
export type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbOrTx = DbClient | Tx;
