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

### 後台登入未實作速率限制／鎖定機制 — 已於 M6 解決
- 里程碑：M3 → M6（已解決）
- 問題：SPEC §10.1「失敗 5 次鎖定 15 分鐘（以 IP + email 計數）」與 §12.1「/admin/login 每 IP 5 次/分」都還沒做。目前 `src/auth.ts` 的 Credentials `authorize()` 只有帳密驗證，沒有失敗計數或鎖定。
- 解法：`src/lib/rate-limit.ts`（固定視窗限流）與 `src/lib/login-guard.ts`（IP+email 失敗計數與鎖定）都是記憶體內實作，在 `authorize()` 裡依序檢查。`POST /api/v1/orders` 的 10 次/分限流也用同一個 `checkRateLimit()`。**仍是單一 process 記憶體內狀態**——多副本部署時每個副本會各自計數，等於實際限制寬鬆了 N 倍（N=副本數），且重啟會重置計數。這在單一 process 部署（目前的開發/測試環境）下完全正確，但正式多副本部署前，需要換成 Redis 之類的共享儲存才能維持限流的正確性；這是刻意的技術債，換掉的時機等部署拓樸（是否用 Cloudflare Workers、是否會多副本水平擴展）確定後再處理，避免現在猜錯方向。
- 影響範圍：`src/lib/rate-limit.ts`、`src/lib/login-guard.ts`、`src/auth.ts`、`src/app/api/v1/orders/route.ts`。

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

### 圖片上傳從 presigned URL 直傳改成伺服器代理上傳
- 里程碑：M6
- 問題：SPEC §8.3 描述的 `POST /admin/uploads/presign` 是讓瀏覽器直接 PUT 到 S3/MinIO 的 presigned URL 流程，伺服器完全不會看到檔案內容；但 §12.1 同時要求「驗證 magic bytes 而非僅副檔名」、「圖片重新編碼為 webp 去除 EXIF」。這兩個要求互斥——presigned 直傳的整個設計目的就是讓檔案不經過伺服器，沒有任何時間點能讓伺服器檢查或轉換內容。
- 暫定假設：拿掉 presign 端點，改成 `POST /api/v1/admin/uploads` 用 `multipart/form-data` 把檔案傳給伺服器，伺服器驗證 magic bytes（`src/lib/image-processing.ts` 的 `detectImageType`）、用 `sharp` 轉成 webp（去 EXIF、最長邊 1200px）後才寫入 S3/MinIO。犧牲的是「檔案不經過我方伺服器」這個 presigned URL 的效能優勢，換取安全性要求；後台商品圖片上傳的頻率與檔案大小（≤5MB）都很小，這個取捨划算。
- 影響範圍：`src/app/api/v1/admin/uploads/route.ts`（取代原本的 `uploads/presign/route.ts`）、`src/lib/image-processing.ts`、`src/app/admin/(dashboard)/products/ProductForm.tsx`、`src/schemas/admin.ts`（移除 `uploadPresignSchema`）。新增 `sharp` 依賴。

### 告警（alerting）目前只有結構化日誌，沒有串接外部通知
- 里程碑：M6
- 問題：SPEC §12.3 列出五種需要告警的事件（webhook 驗簽失敗、AMOUNT_MISMATCH、狀態機非法轉移、PENDING_PAYMENT 逾時率 > 20%、NotImplementedError 被觸發），但沒有指定要串接哪個告警管道（Slack/PagerDuty/Email…），專案也還沒有這類整合。
- 暫定假設：新增 `src/lib/logger.ts` 的 `logger.alert()` 這個獨立 log level，五個事件都會呼叫它（其中四個集中在 `src/lib/errors.ts` 的 `toErrorResponse()`——這是所有 route handler 錯誤處理的唯一共同入口，故把 `AMOUNT_MISMATCH`／`INVALID_STATE_TRANSITION`／`NotImplementedError` 的告警邏輯集中寫在這裡，不必逐一修改三十幾個 route handler；webhook 驗簽失敗的判斷點不在這裡，另外在 `payments/webhook/[provider]/route.ts` 呼叫；逾時率則在 `expire-orders.ts` 的 job 執行完後計算）。輸出仍是結構化 JSON 印到 stdout/stderr，讓日誌收集系統（不論最後接的是 Datadog、CloudWatch、還是 Cloudflare Logs）可以依 `level="alert"` 設條件式通知規則。實際要不要接、接哪個通知管道，等正式維運需求明確後再做。
- 影響範圍：`src/lib/logger.ts`、`src/lib/errors.ts`、`src/app/api/v1/payments/webhook/[provider]/route.ts`、`src/server/order/expire-orders.ts`。

### requestId 只貫穿到 route handler 層，沒有逐一改寫每個呼叫端寫進 log
- 里程碑：M6
- 問題：SPEC §12.3「結構化日誌含 requestId（middleware 產生並貫穿）」——理論上每一筆 log 都該帶 requestId，但專案裡呼叫 `logger.*()` 的地方分散在三十幾個檔案，逐一把 `request.headers.get("x-request-id")` 傳進每個呼叫點是大量機械式改動，價值與工作量不成比例。
- 暫定假設：`src/proxy.ts` 產生 requestId 並寫回請求標頭（`/api`、`/admin` 分支）與回應標頭（全部分支），任何 route handler 都可以透過 `request.headers.get("x-request-id")` 取得；`src/lib/errors.ts` 的 `toErrorResponse()` 支援可選的 `requestId` 參數，但**沒有**強制所有呼叫端都傳。也就是說 requestId 的基礎建設就位、瀏覽器端／技術支援排查可以靠回應標頭關聯請求，但目前只有少數幾處（webhook 簽章失敗）真的把它寫進 log 內容。之後若要求「每一筆告警 log 都要有 requestId」，需要另外排時間做這個機械式改動。
- 影響範圍：`src/proxy.ts`、`src/lib/errors.ts`、`src/app/api/v1/payments/webhook/[provider]/route.ts`。

### AuditLog 是 fire-and-forget、不含 IP、且跟 OrderEvent 有意重疊
- 里程碑：M6
- 問題：SPEC §12.1「所有寫入操作記 AuditLog」沒有規定寫入時機（要不要包進同一筆交易）、要不要記錄操作者 IP，也沒說訂單狀態轉移該不該同時寫 `OrderEvent`（既有機制，見 `state-machine.ts`）跟 `AuditLog`。
- 暫定假設：`writeAuditLog()`（`src/server/admin/audit-log.ts`）刻意做成獨立寫入、不包進主要操作的資料庫交易——稽核記錄失敗不該讓商品/訂單的正常寫入跟著失敗，且大部分 CRUD 呼叫端本身沒有走 `$transaction`。`ip` 欄位（schema 已有）目前一律留空——要填就得把 IP 一路從 route handler 傳進每個 server 函式，跟 requestId 一樣是機械式改動，先不做。訂單狀態轉移／退款會**同時**寫 `OrderEvent`（狀態機層級細節：from/to/actorType）跟 `AuditLog`（讓管理者能在同一張表跨實體類型查詢，不用為了看「誰改了這筆訂單」另外去查 OrderEvent）——這是刻意的重複，不是疏漏。
- 影響範圍：`src/server/admin/audit-log.ts`、`src/server/catalog/admin-{products,categories,option-groups}.ts`、`src/server/order/admin-orders.ts`、`src/server/payment/refund.ts`。目前沒有後台頁面可以瀏覽 AuditLog（只能用 `prisma studio` 或直接查資料庫），UI 留待有實際稽核需求時再做。

### CSP 用 `unsafe-inline`，沒有做 nonce-based CSP
- 里程碑：M6
- 問題：嚴格的 CSP（不含 `unsafe-inline`）能更有效防禦 XSS，但 Next.js App Router 的 hydration/RSC 內嵌 script、以及專案裡手刻圖表元件（`TrendChart`/`TopProductsChart`）用到的 React inline `style` prop，都需要 `unsafe-inline` 才能運作；要收緊成 nonce-based CSP，需要在 middleware 產生 nonce、透過 `x-nonce` 請求標頭傳遞，並讓所有會渲染 inline script/style 的地方讀取並套用同一個 nonce，是有一定工作量的架構調整。
- 暫定假設：`src/lib/security-headers.ts` 的 CSP 對 `script-src`/`style-src` 都用 `'unsafe-inline'`，開發模式（`NODE_ENV !== "production"`）另外放行 `'unsafe-eval'`（React Fast Refresh 需要，正式環境不會用到，React 官方文件本身也這樣說明）。CSP 其餘方向（`default-src 'self'`、`frame-ancestors 'none'`、`connect-src 'self'`…）仍收得很緊，X-Frame-Options/X-Content-Type-Options/Referrer-Policy/HSTS 都有設定，屬於「先把大部分防護做到位」的務實選擇，不是忽略這個問題；nonce-based CSP 留待之後有資源時再做。
- 影響範圍：`src/lib/security-headers.ts`。

### PENDING_PAYMENT 逾時率告警的計算窗口是自訂的（SPEC 沒有明確定義）
- 里程碑：M6
- 問題：SPEC §12.3 只寫「PENDING_PAYMENT 逾時率 > 20%」，沒有定義是用什麼時間窗口計算比例、多小的樣本數不該告警。
- 暫定假設：在 `expireOverdueOrders()`（`src/server/order/expire-orders.ts`）跑完取消迴圈後，額外查「近一小時內下的訂單」為樣本，比較其中最終因逾時被取消的比例；樣本數 < 5 時不告警（避免深夜低流量時段幾筆訂單就誤報）。這個 job 目前靠外部 cron 呼叫 `POST /api/v1/admin/jobs/expire-orders` 觸發（見 M4 的 OPEN-QUESTIONS 說明），故告警的檢查頻率等於外部 cron 設定的頻率，不是固定每小時。
- 影響範圍：`src/server/order/expire-orders.ts`。

### `next.config.ts` 的 `deviceSizes` 依上傳流程的固定限制收窄
- 里程碑：M6
- 問題：Next.js 預設 `deviceSizes` 含 1920/2048/3840 這些大尺寸斷點，但專案的圖片上傳流程（見上方「圖片上傳」條目）已經統一把所有圖片轉成最長邊 1200px 的 webp，這些大尺寸斷點永遠用不到。
- 暫定假設：把 `deviceSizes` 收窄成 `[640, 750, 828, 1080, 1200]`，避免 Next.js image optimizer 為根本不存在的大尺寸來源產生用不到的圖片變體。這是直接由專案自己的上傳限制反推出的收斂，如果之後允許使用者上傳/引用外部大圖（目前沒有這個功能），需要重新評估。
- 影響範圍：`next.config.ts`。

### Playwright 測試檔沒辦法直接用 Prisma；E2E 資料清理另外用 tsx 腳本
- 里程碑：M6
- 問題：Playwright Test 用自己的 CJS-based loader 執行測試檔，Prisma 產生的 client 是純 ESM（`generator client { provider = "prisma-client" }`，見 `prisma/schema.prisma`），在 `tests/e2e/order-flow.spec.ts` 裡不管是靜態 `import` 還是動態 `import()` 引用 `@/lib/db`，都會在執行期噴 `SyntaxError: Cannot use 'import.meta' outside a module`——Playwright 的 loader 會攔截所有 import 路徑，不只是靜態的。
- 暫定假設：E2E 測試本身不在測試檔內做資料庫層級的清理（用瀏覽器操作走完整流程即可，不需要 Prisma），另外寫一支 `scripts/cleanup-e2e-data.ts`（用 `tsx` 執行，已驗證能正常載入 ESM），依 `customerNote = "PLAYWRIGHT_E2E_TEST"` 標記清掉殘留訂單，`npm run test:e2e:cleanup` 執行。另外，後台操作（登入、推進訂單狀態、看統計頁）改成整個測試檔只登入一次、用 Playwright 的 `storageState` 重用已登入的 context，除了避開這個 ESM/CJS 問題本身無關的併發登入問題外，也順便避開 M6 新增的 `/admin/login` 限流（5 次/分）——四語系測試若各自重新登入會在一分鐘內打滿限流額度。
- 影響範圍：`tests/e2e/order-flow.spec.ts`、`scripts/cleanup-e2e-data.ts`、`vitest.config.mts`（需排除 `tests/e2e/**`，否則 Vitest 會誤把 Playwright 的 `*.spec.ts` 當成自己的測試檔載入而噴錯）。

### 沒有跑正式的 Lighthouse 稽核；「效能調校」用手動檢查取代
- 里程碑：M6
- 問題：SPEC §13 M6 驗收條件寫「Lighthouse 行動版 Performance ≥ 85」，但這個開發環境沒有 Chrome DevTools 或 `lighthouse` CLI 可用，沒辦法產生正式的 Lighthouse 分數。
- 暫定假設：改用「已知會影響 Lighthouse Performance 分數的具體項目」逐項檢查與修正，取代跑分：`next/image` 的 `sizes` prop 補齊（避免瀏覽器抓過大的圖片變體）、`next.config.ts` 依實際上傳限制收窄 `deviceSizes`、圖片上傳統一轉 webp 並壓在 1200px 內、`/api/v1/menu` 既有的 `revalidate=60` 快取維持不變。正式 Lighthouse 分數建議在有 Chrome 的環境（本機瀏覽器 DevTools、或 CI 裝 `lighthouse` CLI）另外驗證一次，尤其是部署到正式環境、有真實網路延遲之後再量測才有意義。
- 影響範圍：`src/components/product/product-detail-view.tsx`、`src/app/[locale]/cart/page.tsx`、`next.config.ts`。
