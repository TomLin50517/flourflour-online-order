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
  },
});
