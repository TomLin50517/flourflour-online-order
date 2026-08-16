import { PrismaPg } from "@prisma/adapter-pg";
import { cache } from "react";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prismaNodeSingleton: PrismaClient | undefined;
};

/**
 * 見 docs/OPEN-QUESTIONS.md：Cloudflare Workers runtime 會把 `navigator.userAgent`
 * 固定設為 `"Cloudflare-Workers"`（`wrangler dev`/`opennextjs-cloudflare preview`
 * 用的 Miniflare 模擬器也會回報同一個值），本機 `next dev`/`next build`/Vitest
 * 都不會，用這個判斷目前是不是真的跑在 Workers 上——只有在 Workers 上才會動態
 * import `@opennextjs/cloudflare`，避免這個套件在本機環境造成任何副作用或
 * 意外的建置期依賴。
 */
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/**
 * 見 docs/OPEN-QUESTIONS.md：部署到 Cloudflare Workers 後，Prisma 不能像本機
 * Node.js 那樣在 module 頂層建立一份全域單例連線池——Workers 的 binding（含
 * Hyperdrive）只有在請求進來後、透過 `getCloudflareContext()` 才拿得到，且官方
 * 建議每個請求各自建立 `PrismaClient`（`maxUses: 1` 限制單一底層連線最多重複
 * 使用一次，配合 Workers 的短生命週期執行模型）。用 React 的 `cache()` 讓同一次
 * 請求內多次呼叫 `getDb()` 只會建立一次連線。本機 Node.js（`next dev`／一般
 * Node.js 主機／Vitest）則維持原本 module-level 單例，跨請求重用同一份連線池。
 */
export const getDb = cache(async (): Promise<PrismaClient> => {
  if (isCloudflareWorkersRuntime()) {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const adapter = new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString, maxUses: 1 });
    return new PrismaClient({ adapter });
  }

  if (!globalForPrisma.prismaNodeSingleton) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    globalForPrisma.prismaNodeSingleton = new PrismaClient({ adapter });
  }
  return globalForPrisma.prismaNodeSingleton;
});
