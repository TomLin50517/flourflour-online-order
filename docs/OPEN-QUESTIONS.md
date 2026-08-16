# Open Questions

> 發現規格矛盾或缺漏時，於此新增一筆記錄，並標註採用的暫定假設，不停下等回覆（見 `CLAUDE.md`）。

## 格式

```
### {簡短標題}
- 里程碑：M{n}
- 問題：{具體描述}
- 暫定假設：{採用的假設，含理由}
- 影響範圍：{受影響的檔案/流程}
```

---

### `loading.tsx`（Suspense 串流 fallback）在此專案卡死，不再使用檔案慣例
- 里程碑：M2
- 問題：SPEC §9.2 要求菜單頁有載入骨架屏。依 Next.js App Router 慣例在 `src/app/[locale]/loading.tsx` 建立 Suspense fallback 後，實測發現頁面永久卡在 fallback：伺服器端有正確串流出 fallback + 真實內容（`curl` 可看到兩者皆存在於回應中），但瀏覽器從未把 fallback 換成真實內容——`document.querySelectorAll('main').length` 會變成 2，真實內容以 `hidden` 屬性卡在 DOM 裡。已排除的可能原因：不是 Turbopack 特有（`next dev --webpack` 同樣重現）、不是資料層問題（`/api/v1/menu` 直接呼叫秒回）、跟 fallback 內容複雜度無關（連 `<main><p>Loading…</p></main>` 這麼簡單都會卡，但拿掉 `<main>` 換成單純 `<p>Loading…</p>`（無 `loading.tsx` 檔案時完全不會卡）。判斷是 Next.js 16.3.1 串流 Suspense 的 reveal script 未執行的既有 bug（本地端 DB 查詢通常 < 1s，不太需要真的用到串流 loading）。
- 暫定假設：**移除 `loading.tsx`**，改讓 Server Component 直接同步等待資料（無 Suspense fallback）。菜單頁資料來源是本機 Postgres，查詢極快，實務上使用者不太會看到明顯的空白等待。之後若要重新導入骨架屏，建議：(1) 先確認之後升級的 Next.js 版本是否修掉這個 bug，或 (2) 改用純 client-side fetch + local loading state 的骨架屏（不依賴 App Router 的 `loading.tsx` 檔案慣例），但那會讓菜單頁變成 client-fetched，犧牲 SSR/SEO，需要再評估。
- 影響範圍：`src/app/[locale]/page.tsx`（菜單頁目前無 loading fallback）；`src/components/ui/skeleton.tsx` 元件本身沒問題、保留著，只是目前沒有掛在任何 route 上。之後若同樣要在商品詳情頁或其他頁面加 `loading.tsx`，記得這個雷。

### `Order` model 缺少儲存 Idempotency-Key 的欄位
- 里程碑：M3
- 問題：SPEC §8.2 明確要求 `POST /orders` 必須帶 `Idempotency-Key` header，且「同一 Idempotency-Key 重送 → 回傳原訂單，200」，但 §5.1 給的 `Order` Prisma schema 完全沒有對應欄位可以拿來查重——`orderNo`／`accessToken` 都是建單當下才產生的值，重送時請求端根本不會帶這兩者，無法用來判斷是否為同一次建單請求。
- 暫定假設：在 `Order` 加一個 `idempotencyKey String @unique` 欄位（migration `add_order_idempotency_key`），`POST /orders` 用它做查重。這是新增欄位、不是修改既有欄位語意，應該不牴觸「欄位語意不得變更」的限制。
- 影響範圍：`prisma/schema.prisma`（新欄位）、`prisma/migrations/20260815182441_add_order_idempotency_key/`、`src/server/order/create-order.ts`（用它查重＋寫入）。

### 後台登入未實作速率限制／鎖定機制
- 里程碑：M3
- 問題：SPEC §10.1「失敗 5 次鎖定 15 分鐘（以 IP + email 計數）」與 §12.1「/admin/login 每 IP 5 次/分」都還沒做。目前 `src/auth.ts` 的 Credentials `authorize()` 只有帳密驗證，沒有失敗計數或鎖定。
- 暫定假設：M3 先求登入功能本身正確（bcrypt 比對、session、middleware 保護），鎖定機制留到之後補——單機開發階段用記憶體 Map 就能做，但正式多執行緒/多副本部署需要 Redis 之類的共享儲存，值得等部署方式確定後一起做，避免現在做的東西之後要重寫。
- 影響範圍：`src/auth.ts`。

### REFUNDED 轉移目前一律回 503（PaymentProvider 尚未存在）— 已於 M4 解決
- 里程碑：M3 → M4（已解決）
- 問題：§6.2 REFUNDED 轉移需要先呼叫 `provider.refund()`，但 `PaymentProvider` 介面是 M4 的交付項目。
- 解法：`server/payment/refund.ts` 的 `refundOrder()` 找出該訂單最近一筆 `SUCCEEDED` 的 `Payment`，呼叫 `provider.refund()` 成功後才在交易內更新 `Payment.status = REFUNDED` 並呼叫 `transition()` 轉到 `REFUNDED`。`PATCH /admin/orders/{id}/status`（`toStatus: REFUNDED`）與新增的 `POST /admin/orders/{id}/refund` 共用此函式。真實廠商 adapter 仍未實作時，`provider.refund()` 會拋 `NotImplementedError` → 503，狀態不會被更動，符合「不得因廠商 API 未定而簡化或跳過金流流程」。
- 影響範圍：`src/server/order/admin-orders.ts`、`src/server/payment/refund.ts`、`src/app/api/v1/admin/orders/[id]/refund/route.ts`。

### 訂單看板沒有依「營業日」篩選
- 里程碑：M3
- 問題：§10.2 提到篩選項「日期（預設今日營業日）」，目前 `/admin/orders` 只依狀態分欄，沒有日期篩選（顯示所有非草稿訂單）。
- 暫定假設：先求看板本身（四欄、推進狀態、樂觀鎖衝突提示、輪詢、提示音）正確運作；日期篩選等實際有跨日訂單堆積、看板變得需要篩選時再補，避免在還沒有真實使用回饋前先猜 UI。
- 影響範圍：`src/app/admin/(dashboard)/orders/page.tsx`、`src/server/order/admin-orders.ts`（`listOrdersAdmin` 目前只吃 status/pickupNumber）。

### 沒有分類的商品不會出現在 `/api/v1/menu`，連帶購物車校驗也找不到它
- 里程碑：M3
- 問題：`getMenu()` 是照分類（Category → products）遍歷組出回應，`Product.categoryId` 在 schema 裡是可選欄位，但一個沒有分類的商品實際上不會出現在 menu 回應的任何地方——即使它是 `isActive` 的。連帶影響：購物車頁校驗「是否仍可購買」也是透過 `/api/v1/menu` 的結果反查 productId，找不到就會被判定成不可購買，即使商品本身正常上架。這是我測試建立商品時忘記選分類才踩到的（見商品編輯表單，「未分類」是允許的選項）。
- 暫定假設：目前不特別處理——正常情境下架商品都應該有分類，後台商品表單也一直提醒選分類。先記錄這個邊界情況，之後若真的需要支援「未分類但仍要能被購買」的商品，再考慮讓 `getMenu()` 額外回傳一個「未分類」桶，或是讓購物車校驗改成直接用 productId 查詢而非透過 menu 反查。
- 影響範圍：`src/server/catalog/get-menu.ts`、`src/app/[locale]/cart/page.tsx`。

### 沒有排程器：逾時 job／對帳 job 改由 admin API 端點觸發
- 里程碑：M4
- 問題：SPEC §7.5 要求「每 5 分鐘掃描 PENDING_PAYMENT…」的對帳補償 job，以及訂單逾時（`expiresAt` 已過）要轉 `CANCELLED`。專案的 `package.json` 沒有任何常駐排程/佇列套件（無 node-cron、BullMQ 等），Next.js route handler 本身也沒有內建的背景排程機制。
- 暫定假設：把兩個 job 實作成單純的 server 函式（`server/order/expire-orders.ts` 的 `expireOverdueOrders()`、`server/payment/reconcile.ts` 的 `reconcilePendingPayments()`），可直接被 Vitest 呼叫測試；另外包一層 admin API（`POST /api/v1/admin/jobs/expire-orders`、`POST /api/v1/admin/jobs/reconcile-payments`，皆需登入）供外部排程器（例如 Vercel Cron、OS 的 cron/Task Scheduler、或未來導入的排程服務）定期呼叫觸發。這兩個端點不在 SPEC §8.3 的表格中，是本里程碑為了讓「逾時 job、對帳 job」這項 M4 交付項目可執行而新增的、非規格明列的端點。正式上線前需要設定一個外部排程器打這兩支 API。
- 影響範圍：`src/server/order/expire-orders.ts`、`src/server/payment/reconcile.ts`、`src/app/api/v1/admin/jobs/expire-orders/route.ts`、`src/app/api/v1/admin/jobs/reconcile-payments/route.ts`。

### Webhook／對帳 job 如何找到對應的 `Payment` 紀錄
- 里程碑：M4
- 問題：SPEC §7.2 的 `WebhookEvent` 有 `providerRef`，但沒有規定「一張訂單同時間只能有一筆進行中的 `Payment`」；顧客理論上可能因為重新整理結帳頁而觸發多次 `createCharge()`，產生多筆 `status = PENDING` 的 `Payment`。
- 暫定假設：webhook 處理時優先以 `providerRef` 精確比對；找不到就退而求其次比對「該訂單、該 provider 底下最近一筆 `PENDING` 的 `Payment`」。多數情況下同一張訂單只會有一筆進行中的付款嘗試，這個 fallback 足以應付。若之後真的出現同一訂單多次併發付款嘗試的情境，需要重新設計（例如在 `createCharge()` 階段就作廢舊的 PENDING 付款）。
- 影響範圍：`src/server/payment/webhook.ts` 的 `findPaymentForEvent()`。

### 退款目前僅支援全額退款
- 里程碑：M4
- 問題：SPEC §8.3 `POST /admin/orders/{id}/refund` 的 body 只有 `{ reason }`，沒有金額欄位；`Payment.status` 雖然定義了 `PARTIALLY_REFUNDED`，但 v1 需求（§1.1 R3/R4）沒有明確要求部分退款的後台操作介面。
- 暫定假設：`server/payment/refund.ts` 一律以該訂單最近一筆 `SUCCEEDED` 付款的 `Payment.amount`（= `order.totalAmount`）全額退款，不支援指定金額。`PARTIALLY_REFUNDED` 狀態暫時不會被寫入。若之後真的有部分退款需求，需要重新設計 API 契約（新增金額欄位）與 UI。
- 影響範圍：`src/server/payment/refund.ts`。

### 退款端點沒有 `expectedVersion`，樂觀鎖有極小的競態視窗
- 里程碑：M4
- 問題：SPEC §8.3 明訂 `POST /admin/orders/{id}/refund` 的 body 只有 `{ reason }`（不像 `PATCH .../status` 有 `expectedVersion`），但 `transition()` 的樂觀鎖機制需要呼叫端提供 `expectedVersion`。
- 暫定假設：在 `refundOrder()` 內部，呼叫 `provider.refund()` 之前先讀一次當下的 `order.version`，用它呼叫 `transition()`。介於「讀到 version」與「transition() 內的 updateMany」之間仍有極小的競態窗口（例如同時間有店員手動改了訂單狀態），但機率極低，且 `transition()` 本身的 `updateMany` 仍會在版本真的不符時正確拋出 `ConflictError`，不會靜默寫入錯誤狀態。若要完全消除，需要 SPEC 修改此端點的 body 加回 `expectedVersion`。
- 影響範圍：`src/server/payment/refund.ts`、`src/app/api/v1/admin/orders/[id]/refund/route.ts`。

### 退款尚未同步扣減 `DailyProductSales` 統計
- 里程碑：M4 → M5
- 問題：SPEC §6.2 REFUNDED 轉移的副作用寫「呼叫 `provider.refund()`、更新統計扣除」，但 `DailyProductSales` 的 upsert 邏輯是 M5（統計報表）的交付項目，M4 階段這張表完全還沒有寫入邏輯。
- 暫定假設：M4 的 `refundOrder()` 只處理付款與訂單狀態（`Payment.status`、`Order.status`），不觸碰 `DailyProductSales`。等 M5 建立統計 upsert 服務時，需要同時補上「REFUNDED 轉移時累加 `refundedQty`/`refundedAmount`」這段（見 SPEC §11 更新機制），並用 `npm run stats:rebuild` 驗證與即時累加結果一致。
- 影響範圍：（M5）`server/stats/*`、`src/server/payment/refund.ts`。

### `/dev/mock-pay` 的「模擬逾時」按鈕不送出 webhook
- 里程碑：M4
- 問題：SPEC §7.4 只說三顆按鈕「模擬付款成功 / 失敗 / 逾時」，沒有定義「逾時」在機制上該做什麼。付款失敗（`charge.failed`）與逾時（顧客根本沒完成付款）在真實金流語意上是不同的事件——逾時的本質是「什麼都沒發生，只是時間到了」，不會有廠商 webhook。
- 暫定假設：「模擬逾時」按鈕不呼叫任何 API，只顯示提示文字，讓測試者理解「這筆訂單會在 `expiresAt` 之後被逾時 job（`expireOverdueOrders`）自動轉為 `CANCELLED`」，藉此也順便驗證逾時 job 而非重造一個假 webhook 事件。「模擬付款失敗」才會送出 `charge.failed` webhook。
- 影響範圍：`src/app/dev/mock-pay/MockPayButtons.tsx`、`src/app/api/v1/dev/mock-pay/route.ts`。

### REFUNDED 訂單是否計入 `quantitySold`？SPEC §11 條列容易誤讀
- 里程碑：M5
- 問題：SPEC §11「計入 quantitySold：訂單狀態 ∈ {PAID, PREPARING, READY, COMPLETED} 的所有 OrderItem.quantity」，字面上 `REFUNDED` 不在這個集合裡。但如果照字面解讀成「用訂單目前狀態去判斷是否計入 quantitySold」，一筆訂單被退款後 quantitySold 就會變成 0，而 refundedQty 卻仍然是原本的數量——`netQuantity = quantitySold − refundedQty` 會變成負數，跟 §11 自己說「netQuantity 為報表預設顯示欄」的用途矛盾（報表不該預設顯示一堆負數）。
- 暫定假設：採「事件疊加」語意而非「目前狀態」語意——quantitySold 只在 → PAID 那一刻累加一次，之後不管訂單後來變成什麼狀態都不會再減少；REFUNDED 只會【額外】疊加 refundedQty，讓 netQuantity 自然扣回去。也就是說「PAID 之後又被退款」的訂單，quantitySold 依然計入（因為它確實被賣出過），只是 netQuantity 會被退款數量扣減。這個語意同時實作在即時累加（`server/stats/daily-product-sales.ts` 的 `applyDailyProductSales`，由 webhook/reconcile 的 PAID 分支與 refund.ts 的 REFUNDED 分支個別呼叫一次）與批次重算（`server/stats/rebuild.ts`：篩選 `paidAt IS NOT NULL` 的訂單一律計入 quantitySold，目前狀態為 REFUNDED 者才【額外】計入 refundedQty）兩條路徑，兩者刻意保持完全一致（見 `tests/stats-rebuild.test.ts` 驗證兩者結果相同）。
- 影響範圍：`src/server/stats/daily-product-sales.ts`、`src/server/stats/rebuild.ts`、`src/server/payment/webhook.ts`、`src/server/payment/reconcile.ts`、`src/server/payment/refund.ts`。

### `GET /admin/stats/summary` 的預設區間與回傳欄位超出 SPEC §8.3 字面描述
- 里程碑：M5
- 問題：SPEC §8.3 只說這支端點回傳「當日營收、單量、平均客單價、熱銷 Top 10」，沒提供 `from`/`to` 查詢參數，也沒提到 §10.5 頁面另外需要的「退款金額」KPI 卡與「趨勢圖」用的逐日資料。
- 暫定假設：把 `from`/`to` 設計成可選查詢參數——都不帶時預設為「當日（今日營業日）」，符合 §8.3 字面「當日」的說法；帶了就依區間彙總，供 `/admin/stats` 頁面的日期篩選（今日/昨日/近7日/本月）共用同一支端點。回應內容額外加上 `refundAmount`（§10.5 KPI 卡需要）與 `dailyTrend`（區間內逐日訂單數/營收，§10.5 趨勢圖需要），避免前端為了兩張圖表/四張 KPI 卡而發三支不同的請求。這些都是回應內容的擴充而非既有欄位語意變更，不牴觸「介面凍結」原則。
- 影響範圍：`src/server/stats/report.ts`（`getStatsSummary`）、`src/app/api/v1/admin/stats/summary/route.ts`、`src/schemas/admin.ts`（`statsSummaryQuerySchema`）。

### 銷售量表「佔比」欄位以淨數量為基準；CSV／圖表不使用外部套件
- 里程碑：M5
- 問題：SPEC §10.5 只寫「佔比」，沒說是佔銷售數量、淨數量還是金額的比例；也沒規定 CSV 匯出與雙軸折線圖／Top 10 長條圖要不要用套件實作。
- 暫定假設：「佔比」＝該商品淨數量佔區間內【全部商品淨數量總和】的比例，與表格預設排序欄位（淨數量）一致，前端不需要額外算兩套百分比。CSV（`src/lib/csv.ts`）與兩張圖表（`src/app/admin/(dashboard)/stats/{TrendChart,TopProductsChart}.tsx`）都刻意不引入新套件（`papaparse`、`recharts` 之類）——專案目前完全沒有圖表/CSV 相關依賴（見 `package.json`），只為兩張簡單圖表和一個字串產生器新增依賴不划算，手刻的 inline SVG／CSV 字串已足夠涵蓋 SPEC 需求。
- 影響範圍：`src/server/stats/report.ts`、`src/lib/csv.ts`、`src/app/admin/(dashboard)/stats/*`。
