# CLAUDE.md — 線上點單系統 專案規範

> 本檔為 Claude Code 的常駐指令。**每次動工前先讀 `SPEC.md`。**
> 本檔規範「怎麼寫」，`SPEC.md` 規範「寫什麼」。兩者衝突時以 `SPEC.md` 為準。

---

## 專案一句話

四語系（zh-TW / en / ja / ko）線上點單網站 + 管理後台。顧客線上點餐刷卡，付款成功後取得店內自取的取餐號碼；後台管理商品與訂單，並統計每日各商品銷售量。金流廠商 API 尚未提供，以介面與 Mock 完整佔位。

## 技術棧

Next.js 15 (App Router) · TypeScript strict · PostgreSQL 16 · Prisma · next-intl · Tailwind + shadcn/ui · Zod · Auth.js v5 · Vitest + Playwright

---

## 開工前必做

1. 讀完 `SPEC.md`，特別是 §14「已識別的需求缺口與預設決策」與附錄 B「不得做的事」
2. 確認目前處於哪個里程碑（`SPEC.md` §13），**一次只做一個里程碑**
3. 若發現規格矛盾或缺漏 → 寫入 `docs/OPEN-QUESTIONS.md` 並**標註你採用的暫定假設**，繼續前進，不要停下來等回覆
4. 不要擴充 `SPEC.md` §1.2 列為 Out of Scope 的功能

---

## 常用指令

```bash
npm run dev                # 開發伺服器
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run test               # Vitest
npm run test:e2e           # Playwright
npm run db:migrate         # prisma migrate dev
npm run db:seed            # 種子資料（4 語系 × ≥8 商品）
npm run db:studio          # Prisma Studio
npm run stats:rebuild      # 由訂單明細全量重算 DailyProductSales
docker compose up -d       # Postgres + MinIO
```

**每個里程碑結束前必須全綠**：`npm run typecheck && npm run lint && npm run test`

---

## 分層與依賴方向

```
app/           →  server/        →  lib/  →  prisma
(HTTP/UI)         (商業邏輯)        (工具)
```

- **依賴只能單向往右**，不得反向 import
- `server/**` 內**不得** import `next/server`、`next/headers`、任何 React 相關模組 —— 這層必須可被 Vitest 直接測試
- `app/api/**` 只做三件事：解析與驗證輸入（Zod）→ 呼叫 `server/*` → 序列化回應
- 錯誤處理集中在 `lib/errors.ts` 的 `toErrorResponse()`；route handler 不自行拼裝錯誤 JSON

---

## 硬性規則（違反即需重做）

### 金額
- 一律 `Int`，最小貨幣單位（TWD 即「元」）。**禁止 float / double / 字串運算**
- 所有金額運算集中於 `lib/money.ts` 的純函式，該檔要求 100% 分支覆蓋
- **前端傳來的任何價格欄位一律忽略**，伺服器一律依 DB 重算

### 訂單狀態
- 只能透過 `server/order/state-machine.ts` 的 `transition()` 變更狀態
- **禁止**在任何地方寫 `prisma.order.update({ data: { status } })`
- 每次轉移都要寫一筆 `OrderEvent`
- 使用樂觀鎖：`WHERE id = ? AND version = ?`，affectedRows = 0 即拋 `ConflictError`

### 取貨單號
- 只在 `PENDING_PAYMENT → PAID` 的同一 DB 交易內配發
- 只能透過 `server/order/pickup-number.ts` 的原子 UPSERT 取號，禁止 `SELECT MAX(seq) + 1`

### 金流
- 所有廠商互動都經 `PaymentProvider` 介面，禁止在 `server/` 或 `app/` 直接呼叫廠商 SDK
- 未知的廠商 API 細節 → 寫 `TODO(VENDOR-API): <具體缺什麼>` 並 `throw new NotImplementedError(...)`
- **不得為了讓程式跑起來而猜測廠商參數格式或簽章演算法**
- 訂單付款成功只認 webhook，不認 returnUrl
- Webhook：先驗簽 → 再以 `PaymentEvent(provider, providerEventId)` 唯一鍵去重 → 再比對金額
- 絕不儲存 / 記錄完整卡號、CVV

### 多語系
- **任何面向顧客的字串都不得硬編碼在元件裡**，一律 `useTranslations()` / `getTranslations()`
- 新增 UI 字串時，**四個 `messages/*.json` 必須同步新增同一 key**（缺 key 會導致 CI 失敗）
- 商品內容走 DB 翻譯表；讀取時 fallback 至 `ZH_TW`
- 後台 `/admin/*` 固定 zh-TW，不做 i18n

### 資料庫
- 每次 schema 變更都要有 migration 檔，禁止 `prisma db push` 到已有 migration 的分支
- 商品採軟刪除（`deletedAt`），查詢一律過濾
- 涉及多表寫入必用 `prisma.$transaction`
- 新增查詢時檢查是否需要索引；`SPEC.md` §5.1 已定義的索引不得移除

---

## 撰寫風格

- TypeScript `strict: true`；**禁止 `any`**，不得已時用 `unknown` + type guard，並註明理由
- 禁止非空斷言 `!`（除了測試檔）
- 型別優先用 Zod schema 推導：`type CreateOrderInput = z.infer<typeof createOrderSchema>`
- Server Component 為預設；只有需要互動時才加 `'use client'`，且盡量下推到葉節點
- 資料存取只在 Server Component / Server Action / route handler，禁止在 client 直接接 DB
- 元件單檔 ≤ 200 行；超過就拆
- 註解寫「為什麼」，不寫「做什麼」；商業規則的註解要引用 `SPEC.md` 章節編號（例：`// 見 SPEC.md §11 統計口徑`）
- 錯誤訊息：對顧客用 i18n key，對開發者用英文技術訊息寫進 log

---

## 測試要求

| 寫什麼程式碼 | 就要寫什麼測試 |
|---|---|
| `lib/money.ts` | 單元測試，100% 分支 |
| `state-machine.ts` | 合法轉移全通過 + **所有非法轉移被拒**的表格驅動測試 |
| `pickup-number.ts` | 併發 200 筆不重號、跨 cutoff 重置、超上限進位 |
| 建單流程 | 選項驗證錯誤情境、金額重算、Idempotency-Key 重送 |
| Webhook | 驗簽失敗、重複事件、金額不符三種情境 |
| 統計 | 含退款的情境，並與 `stats:rebuild` 結果比對 |
| 頁面流程 | Playwright，四語系各跑一次完整下單流程 |

測試要測**行為與規則**，不要為了覆蓋率測 getter。禁止為了讓測試過而修改斷言。

---

## Git 慣例

- 分支：`feat/m3-order-state-machine`、`fix/webhook-idempotency`
- Commit：Conventional Commits（`feat:` `fix:` `refactor:` `test:` `docs:` `chore:`）
- 一個 commit 一件事；不要把 migration 和 UI 改動混在一起
- 每個里程碑結束開一個 PR，描述中列出：完成項目、未完成項目、新增的 `TODO(VENDOR-API)`、新增的 OPEN-QUESTIONS

---

## 回報格式

每個里程碑完成時，用以下格式回報：

```
## M{n} 完成

### 已實作
- …

### 驗收結果
- typecheck / lint / test：✅ 或 ❌ + 原因
- 該里程碑 SPEC §13 的驗收條件逐條對照

### 新增的 TODO(VENDOR-API)
- 檔案:行 — 缺少什麼廠商資訊

### 待確認問題（已寫入 docs/OPEN-QUESTIONS.md）
- 問題 — 我採用的暫定假設
```

---

## 反覆出現的陷阱（請主動檢查）

1. 新增商品欄位時忘記同步四語系翻譯表 → 顧客看到中文夾雜
2. 新增 UI 字串只改了 `zh-TW.json`
3. 統計用日曆日而非營業日（見 `SPEC.md` §14.3）
4. 退款統計歸屬到退款當日而非原付款日（見 `SPEC.md` §11）
5. 在 `PENDING_PAYMENT` 就配發取貨號
6. 訂單狀態頁忘記在終態停止輪詢，造成無限請求
7. 圖片上傳未做 magic bytes 驗證，只看副檔名
8. Webhook 先 `JSON.parse` 再驗簽 → 簽章必然對不上（必須留原始 rawBody）
9. 後台看板多人同時操作，未帶 `expectedVersion` 導致狀態被覆蓋
10. 商品改價後，歷史訂單金額跟著變（快照沒寫或讀取時去 join 商品表）

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
