# FlourFlour 線上點單系統

四語系（zh-TW / en / ja / ko）線上點單網站 + 管理後台。顧客線上點餐刷卡，付款成功後取得店內自取的取餐號碼；後台管理商品與訂單，並統計每日各商品銷售量。

詳細規格見 [`SPEC.md`](./SPEC.md)，開發規範見 [`CLAUDE.md`](./CLAUDE.md)，已知的規格缺口/暫定假設見 [`docs/OPEN-QUESTIONS.md`](./docs/OPEN-QUESTIONS.md)，金流廠商串接待辦見 [`docs/VENDOR-API-CHECKLIST.md`](./docs/VENDOR-API-CHECKLIST.md)。

**目前進度：M0–M6 全部完成**（見 `SPEC.md` §13）。金流廠商（綠界/藍新/TapPay）串接因廠商 API 文件尚未到位，adapter 仍是骨架（`NotImplementedError` 佔位），僅 Mock provider 全流程可用。

## 快速開始

```bash
docker compose up -d       # 啟動 Postgres 16 + MinIO
cp .env.example .env       # 首次設定，依需要調整
npm install                # 會自動跑 postinstall: prisma generate
npm run db:migrate         # 套用 migration
npm run db:seed            # 種子資料：4 語系 × 10 商品 + 2 規格群組 + 後台帳號
npm run storage:init       # 建立 MinIO bucket 並設 public-read policy
npm run dev                # http://localhost:3000
```

後台入口：`http://localhost:3000/admin/login`。預設帳密由 `prisma/seed.ts` 建立，可用環境變數 `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` 覆寫，未設定時為 `admin@flourflour.test` / `admin1234`（僅供本機開發，正式環境務必更換）。

## 環境變數

完整清單見 [`.env.example`](./.env.example)。金流廠商（`ECPAY_*`/`NEWEBPAY_*`/`TAPPAY_*`）在文件到位前留空即可，`PAYMENT_PROVIDER=mock` 是預設值。`businessDayCutoff`/`timezone`/`currency`/取貨號設定的**執行期**唯一來源是 `Store` 資料表（見 `SPEC.md` §12.4），環境變數只在 `db:seed` 時作為初始值。

## 常用指令

```bash
npm run dev                # 開發伺服器
npm run build               # 正式建置（next build）
npm run start                # 以正式建置模式啟動
npm run typecheck           # next typegen && tsc --noEmit
npm run lint                 # ESLint
npm run test                 # Vitest（單元/整合測試，會連真實本機 Postgres）
npm run test:e2e             # Playwright E2E（四語系完整下單流程，見下方）
npm run test:e2e:cleanup     # 清除 E2E 測試殘留的訂單資料
npm run db:migrate           # prisma migrate dev
npm run db:seed              # 種子資料
npm run db:studio            # Prisma Studio
npm run storage:init         # 建立/設定 MinIO bucket
npm run stats:rebuild -- --from=2026-08-01 --to=2026-08-31   # 由訂單明細全量重算銷售統計
```

**每個里程碑結束前必須全綠**：`npm run typecheck && npm run lint && npm run test`

## 測試

- **單元／整合測試**（Vitest）：`npm run test`。固定連本機 Postgres（`docker compose up -d` 需先啟動），覆蓋金額計算、狀態機、取貨號併發配號、建單、webhook 冪等/驗簽/金額比對、銷售統計累加與 `stats:rebuild` 一致性等關鍵路徑。若 `.env` 的 `DATABASE_URL` 已經換成遠端資料庫（例如 Supabase），`tests/setup.ts` 會用 `.env.test`（複製 `.env.test.example`）覆蓋回本機連線，避免併發測試（如 200 筆取貨號配號）因網路延遲逾時、也避免測試資料寫進遠端的開發資料庫。見 `docs/OPEN-QUESTIONS.md`。
- **E2E 測試**（Playwright）：`npm run test:e2e`。四語系（zh-TW/en/ja/ko）各跑一次完整流程——瀏覽商品 → 選規格 → 加入購物車 → 結帳 → Mock provider 付款 → 取得取貨號 → 後台推進至完成，另外檢查銷售統計頁可正常載入。第一次執行前需要安裝瀏覽器執行檔：

  ```bash
  npx playwright install chromium
  ```

  測試會走真實下單流程並寫入資料庫，跑完建議執行 `npm run test:e2e:cleanup` 清掉標記為 `PLAYWRIGHT_E2E_TEST` 的訂單。

## 開發用付款模擬

`PAYMENT_PROVIDER=mock`（預設）時，結帳送出後會導向 `/dev/mock-pay`，可手動點擊「模擬付款成功／失敗」；此頁面與觸發端點僅在 `NODE_ENV !== "production"` 時註冊（見 `SPEC.md` §7.4）。webhook 驗簽用 `MOCK_WEBHOOK_SECRET`（HMAC-SHA256），走的是與真實廠商完全相同的處理路徑（`POST /api/v1/payments/webhook/mock`），不是另開後門。

## 部署備忘

專案本身是一般的 Next.js Server（Node.js runtime），部署到 Vercel 或任何一般 Node.js 主機（Railway/Render/Fly.io 等）沒有已知障礙。目標架構是 **Cloudflare Workers（網頁）+ R2（圖檔）+ Supabase Postgres（資料庫，經 Hyperdrive）**，目前狀態：

1. ~~`src/proxy.ts`（Next.js Middleware）被判定為需要 Node.js runtime~~ **已解決**：查證 Next.js 16 官方文件確認 `proxy.ts` 架構性地宣告為 Node.js runtime、無法改成 edge（跟檔案裡 import 什麼無關，`runtime` config 選項在 Proxy 檔案裡設定了會直接拋錯），是 Next.js 16 新 Proxy 架構與 `@opennextjs/cloudflare` adapter 之間的已知生態相容性落差（[cloudflare/workers-sdk#13937](https://github.com/cloudflare/workers-sdk/issues/13937)）。解法是**整個移除 `src/proxy.ts`**，把裡面做的四件事（後台登入檢查、安全標頭、requestId、根路徑語言協商）分散到不受這個限制的地方（layout／`next.config.ts`／`app/page.tsx`）。已用 `npm run cf:build` 驗證整個建置一路跑完，無任何 middleware 相關錯誤。細節見 `docs/OPEN-QUESTIONS.md`。
2. ~~`bcrypt`（後台登入密碼比對）是原生 C++ binding，Workers runtime 不支援~~ **已解決**：換成純 JS 的 `bcryptjs`（同樣的 `$2b$` hash 格式、相容 API），已用瀏覽器實測既有帳號（密碼 hash 是舊版 `bcrypt` 產生的）仍能正常登入。見 `docs/OPEN-QUESTIONS.md`。
3. Prisma 走 TCP 連線，Workers runtime 預設不能開 TCP 連線到資料庫：`src/lib/db.ts` 已改成依 runtime 切換——本機 Node.js 用 `process.env.DATABASE_URL` 走既有的 module-level 單例；偵測到 Cloudflare Workers（`navigator.userAgent === "Cloudflare-Workers"`）時動態載入 `@opennextjs/cloudflare`，透過 `env.HYPERDRIVE.connectionString` 走 Hyperdrive binding，每個請求各自建立 `PrismaClient`（`maxUses: 1`）。`wrangler.jsonc` 已加入 Hyperdrive binding 佔位（`id` 是假值）。**尚未完成**：實際建立 Hyperdrive 資源需要 Cloudflare 帳號權限，這步驟只能由專案擁有者自己做——`npx wrangler login` 後執行 `npx wrangler hyperdrive create <NAME> --connection-string="<Supabase Direct connection URI>"`（Supabase 官方建議 Hyperdrive 要接 **Direct connection**，不是 Session pooler——Hyperdrive 自己會做連線池化，且 Cloudflare 的網路本身有 IPv6，不受本機開發環境的 IPv6 限制影響），再把輸出的真實 id 填回 `wrangler.jsonc`。跑 `npm run cf:typegen` 可以把 `cloudflare-env.d.ts` 換成用 `wrangler types` 產生的正式版本。
4. ~~圖檔上傳（`src/app/api/v1/admin/uploads/route.ts`）用 `sharp` 做 webp 轉檔，`sharp` 是原生 binding，Workers runtime 不支援~~ **已解決**：換成 `@cf-wasm/photon`（WASM，`/node`／`/workerd`／`/edge-light` 皆可用）。過程中發現並繞開了該套件 `rotate()` 的一個色彩正確性 bug（改用手動 raw-pixel 座標搬移做 90/180/270 度旋轉），且 `get_bytes_webp()` 只支援無損壓縮（無 `sharp` 原本的 quality 82 有損選項，輸出檔案會較大——SPEC 沒有規定要有損壓縮，故不算違反規格，但是已知的效能取捨）。已用實際 HTTP 上傳（`/api/v1/admin/uploads`）＋瀏覽器解碼驗證輸出是有效 webp。細節見 `docs/OPEN-QUESTIONS.md`。

資料庫本身維持 Postgres 即可（`SPEC.md` ADR-2 的選型理由——訂單狀態機的樂觀鎖、取貨號原子遞增都需要 Postgres 等級的交易一致性），不建議為了配合 Workers 換成 SQLite/D1；改連線方式（Hyperdrive）即可，schema 不需要變動。圖檔儲存已經是 `@aws-sdk/client-s3` 走 S3 相容 API（原本接 MinIO），換成 R2 只需要調整 `STORAGE_*` 環境變數，程式碼不用改。

### Cloudflare 相關指令

```bash
npm run cf:build      # 本機驗證 Workers 建置（不需要真的部署，就能抓出相容性問題）
npm run cf:preview    # 本機用 Workers runtime（Miniflare）預覽
npm run cf:deploy     # 建置並部署到 Cloudflare
npm run cf:typegen    # 從 wrangler.jsonc 的 binding 設定產生正式的 cloudflare-env.d.ts
```

首次部署前需要：`npx wrangler login`，然後照上面第 3 點建立 Hyperdrive 資源並把 id 填進 `wrangler.jsonc`。

## 專案結構

```
src/
├── app/            # HTTP/UI 層：[locale] 前台、admin 後台、api/v1 REST API
├── components/     # React 元件
├── lib/            # 工具函式（money、errors、logger、payment、i18n…），不含商業邏輯
├── server/         # 商業邏輯層，不得 import next/server，可被 Vitest 直接測試
├── schemas/        # Zod schema（前後端共用的唯一真實來源）
└── generated/      # Prisma Client（gitignore，`npm install` 時自動產生）
prisma/             # schema、migrations、seed
tests/              # Vitest 單元/整合測試
tests/e2e/          # Playwright E2E 測試
scripts/            # CLI 工具（stats:rebuild、storage:init、E2E 清理）
docs/               # OPEN-QUESTIONS.md、VENDOR-API-CHECKLIST.md
```

依賴方向只能單向：`app → server → lib → prisma`（見 `CLAUDE.md`）。
