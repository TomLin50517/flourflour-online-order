import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["./tests/setup.ts"],
    // tests/e2e/**/*.spec.ts 是 Playwright 的測試檔（見 playwright.config.ts），
    // 不是 Vitest 的——檔名同樣符合 Vitest 預設的 *.spec.ts 規則，須明確排除，
    // 否則 Vitest 會嘗試載入它並在呼叫 test.beforeAll() 時噴錯。
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    // 見 docs/OPEN-QUESTIONS.md：測試檔數量隨里程碑增加後，Vitest 預設會把不同
    // 測試檔分派到多個平行 worker process，每個 process 各自持有一份資料庫
    // 連線池（同一支 tests/pickup-number.test.ts 內部又會併發打開 200 筆交易）。
    // 多個 process 的連線池加總很容易超過本機 Postgres 的 max_connections，
    // 讓那 200 筆併發交易在等待連線時逾時。改成不同測試檔依序執行（單一
    // process、共用同一份連線池）解決連線數爭用，不必去動 Postgres 設定。
    fileParallelism: false,
  },
});
