// 見 docs/DRIZZLE-MIGRATION-SPEC.md §6.1：取代 prisma.config.ts。
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  // 不設定 casing：schema.ts 每個欄位都已明確給了跟 Prisma 產生的完全一致的欄位名稱
  // 字串（例如 text("storeId")），不依賴 drizzle-kit 的自動 camelCase/snake_case 轉換。
});
