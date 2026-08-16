import { defineConfig, devices } from "@playwright/test";

// 見 SPEC.md §12.5：Playwright E2E，四語系各跑一次完整下單流程。
// 併發下單會搶同一個取貨單號序號，故關閉並行、單一 worker 依序跑，
// 避免測試之間互相干擾（跟 Vitest 那邊處理併發測試檔案互相干擾的考量一樣）。
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
