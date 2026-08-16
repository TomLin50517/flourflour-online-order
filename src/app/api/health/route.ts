import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

type MigrationRow = { migration_name: string; finished_at: Date | null };

// 見 SPEC.md §12.3：/api/health 回傳 DB 連線與 migration 版本。無需登入，
// 供監控/負載平衡器探測使用，故只回傳連線是否正常與最新已套用的 migration 名稱，
// 不含任何機敏資訊。
export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - startedAt;

    const rows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    const latestMigration = rows[0];

    return NextResponse.json({
      status: "ok",
      database: { connected: true, latencyMs },
      migration: latestMigration
        ? { name: latestMigration.migration_name, appliedAt: latestMigration.finished_at }
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
