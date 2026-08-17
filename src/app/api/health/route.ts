import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";

type MigrationRow = { hash: string; created_at: string | null };

// 見 SPEC.md §12.3：/api/health 回傳 DB 連線與 migration 版本。無需登入，
// 供監控/負載平衡器探測使用，故只回傳連線是否正常與最新已套用的 migration 名稱，
// 不含任何機敏資訊。
//
// 見 docs/DRIZZLE-MIGRATION-SPEC.md §6.2：改查 drizzle-kit 的追蹤表
// `drizzle.__drizzle_migrations`（baseline 已於本機與正式環境套用）。
export async function GET() {
  const startedAt = Date.now();

  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - startedAt;

    const result = await db.execute<MigrationRow>(sql`
      SELECT hash, created_at
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const latestMigration = result.rows[0];

    return NextResponse.json({
      status: "ok",
      database: { connected: true, latencyMs },
      migration: latestMigration
        ? { hash: latestMigration.hash, appliedAt: new Date(Number(latestMigration.created_at)) }
        : null,
    });
  } catch (error) {
    logger.error("health check failed", {
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    });
    return NextResponse.json(
      { status: "error", database: { connected: false } },
      { status: 503 },
    );
  }
}
