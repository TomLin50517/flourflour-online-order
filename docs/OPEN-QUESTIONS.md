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
- **後續變更（M6 後期，移除 `src/proxy.ts` 時）**：整個 middleware 統一產生＋貫穿 requestId 的機制隨 `src/proxy.ts` 一併移除（見下方「移除 `src/proxy.ts`」條目）。唯一還在用 requestId 的地方（webhook 簽章失敗告警）改成 `request.headers.get("x-request-id") ?? randomUUID()`——沒有上游傳入時自己生一個，至少每次告警還是有一個可追蹤的 ID，只是不再是「從瀏覽器一路貫穿到 server」的全域關聯 ID。這是比原本更弱的版本（SPEC §12.3 字面上要求「middleware 產生並貫穿」），但考量到：(1) 原本就只有這一處真的把它寫進 log；(2) webhook 呼叫方是金流廠商而非瀏覽器，「貫穿到瀏覽器端」這個好處對這個 route 本來就用不到；(3) 換來的是整個 app 能部署到 Cloudflare Workers——判斷這個權衡合理，不再視為需要之後補齊的缺口。
- 影響範圍：~~`src/proxy.ts`~~（已移除）、`src/lib/errors.ts`、`src/app/api/v1/payments/webhook/[provider]/route.ts`。

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

### `auth.ts` 拆成 `auth.config.ts` + `auth.ts`，讓 middleware 保持 edge-safe
- 里程碑：M6（部署嘗試期間追加）
- 問題：實際嘗試部署到 Cloudflare Workers（`@opennextjs/cloudflare` adapter）時，建置在 `npx opennextjs-cloudflare build` 這步噴 `ERROR Node.js middleware is not currently supported`。原因是 `src/proxy.ts` 為了在 middleware 判斷 `/admin/*` 是否已登入，import 了 `./auth`，而 `auth.ts` 用同一個 `NextAuth(...)` 呼叫把 Credentials provider 的 `authorize()`（用到 `bcrypt`、Prisma，兩者都是 Node-only）跟給 middleware 用的 `auth` wrapper 綁在同一個檔案匯出，導致 middleware 的 bundle 被連帶判定為需要 Node.js runtime。
- 解法：採用 Auth.js 官方建議的 edge-safe 拆分模式——新增 `src/auth.config.ts`，只放 middleware 真正需要的設定（`session` 策略、`callbacks`，`providers` 留空）；`src/auth.ts` 疊上完整的 Credentials provider，給 API route handler／Server Component／Server Action 用；`src/proxy.ts` 改成自己用 `authConfig` 另外建一個輕量的 `NextAuth(authConfig).auth`，不再 import 完整版 `auth.ts`。這個拆分跟資料庫放在哪裡無關——不管日後接 Hyperdrive 還是一般 Node.js 主機，都是正確、值得保留的架構。已用瀏覽器手動驗證：未登入導向 `/admin/login`、登入後可進 `/admin/orders`、登出後再次被導向登入頁，三段都正常。
- **重要澄清（M6 後期，接 Hyperdrive 時發現）**：這個拆分**沒有**、也**不能**解決「Node.js middleware is not currently supported」這個錯誤本身——用 `npm run cf:build` 對照實驗過，把 `src/proxy.ts` 改回直接 import 完整版 `./auth.ts`（撤銷拆分）重新建置，噴出一字不差的同一個錯誤。真正原因是 Next.js 16 官方文件明寫：「Proxy defaults to using the Node.js runtime...Setting the `runtime` config option in Proxy will throw an error」——`proxy.ts` 在 Next.js 16 裡**架構性地**宣告為 Node.js runtime，沒有辦法改成 edge，跟檔案裡 import 了什麼完全無關。當初這個拆分「看起來」解決了問題，很可能是因為 Cloudflare Dashboard 當時自動偵測、鎖定的是一個還沒跟進 Next.js 16 這個新規則的舊版 `@opennextjs/cloudflare`（還在用「檢查 middleware bundle 裡有沒有 Node-only import」這種舊邏輯判斷，而不是讀 Proxy 本身宣告的 runtime）；這次手動裝 `@opennextjs/cloudflare@latest`（1.20.2）才第一次真正踩到這個新版更嚴格、更符合 Next 16 語意的檢查。這是 Next.js 16 新 Proxy 架構與 `@opennextjs/cloudflare` adapter 之間的已知生態相容性落差（見 [cloudflare/workers-sdk#13937](https://github.com/cloudflare/workers-sdk/issues/13937)、[#13755](https://github.com/cloudflare/workers-sdk/issues/13755)，皆尚未有官方修復），不是這個專案程式碼能單方面解決的問題。拆分本身仍保留（bundle 精簡、對其他部署方式仍是正確作法），但不再宣稱它「解決」了 Cloudflare Workers 部署問題。
- 影響範圍：`src/auth.config.ts`（新增）、`src/auth.ts`、`src/proxy.ts`。

### Vitest 關閉 `fileParallelism`，避免多測試檔併發搶 Postgres 連線
- 里程碑：M6
- 問題：隨著里程碑增加、測試檔數量變多（現有 15 個 Vitest 檔案），`npm run test` 會間歇性（後期變成穩定重現）在 `tests/pickup-number.test.ts` 的「200 筆併發配號」測試噴 `Unable to start a transaction in the given time`。原因是 Vitest 預設把不同測試檔分派到多個平行 worker process，每個 process 各自建立一份 Prisma 連線池（`lib/db.ts` 的 singleton 是 per-process，不是全域共用），多個 process 的連線池加總容易超過本機 Postgres 的 `max_connections`，讓那 200 筆併發交易在等待可用連線時逾時。單獨執行該測試檔則完全不會重現（沒有其他 process 在搶連線）。
- 暫定假設：在 `vitest.config.mts` 設定 `fileParallelism: false`，讓所有測試檔依序執行、共用同一份連線池，避免連線數爭用；用調小 Vitest 檔案並行度換來測試穩定，執行時間仍在可接受範圍（本機約 3–4 秒）。若之後測試檔數量再大幅增加、依序執行時間變得不可接受，才需要考慮改成調大 Postgres `max_connections` 或改用專屬的測試資料庫連線池設定。
- 影響範圍：`vitest.config.mts`。

### `bcrypt` 換成 `bcryptjs`，解決 Workers runtime 不支援原生 binding 的問題
- 里程碑：M6（部署嘗試期間追加）
- 問題：`src/auth.ts` 的 Credentials provider 用 `bcrypt.compare()` 驗證密碼，`bcrypt` 是原生 C++ binding，Cloudflare Workers runtime 無法載入。這個問題跟先前解決的「Node.js Middleware」是兩回事——middleware 拆分只解決了 `src/proxy.ts` 不再連帶引用 `bcrypt`，但 `src/auth.ts`／`prisma/seed.ts` 這些真正呼叫 `bcrypt.compare()`／`bcrypt.hash()` 的地方本身還是會在 Workers runtime 執行期報錯。
- 解法：換成 `bcryptjs`（純 JS 實作，同樣的 `$2b$` hash 格式、相容的 `hash()`/`compare()` 簽章），`src/auth.ts` 與 `prisma/seed.ts` 都只改了 import。已用瀏覽器實測驗證兩個方向都正確：(1) 用既有帳號（密碼 hash 是先前用原生 `bcrypt` 產生的）登入，確認 `bcryptjs.compare()` 能讀懂舊 hash；(2) `npm run test` 80 個既有測試全過，`typecheck`/`lint` 全過。
- 影響範圍：`src/auth.ts`、`prisma/seed.ts`、`package.json`（移除 `bcrypt`/`@types/bcrypt`，新增 `bcryptjs`）。

### `sharp` 換成 `@cf-wasm/photon`，且繞開該套件 `rotate()` 的一個已知 bug
- 里程碑：M6（部署嘗試期間追加）
- 問題：`src/lib/image-processing.ts` 的 `reencodeToWebp()` 用 `sharp`（libvips 原生 binding）把上傳圖片轉成 webp、依 EXIF 方向校正、縮到最長邊 1200px、去除 EXIF。`sharp` 同樣是 Workers runtime 不支援的原生 binding。找過的替代方案：`wasm-vips`（用 Emscripten pthreads，Workers 不支援 SharedArrayBuffer/worker threads，官方本身就說「無法在 Cloudflare Workers 執行」）、Cloudflare Images（另一個要付費、要另外串接的 CF 產品，先不考慮）、`@cf-wasm/photon`（把 `photon-rs` 編譯成 WASM，有 `/node`、`/workerd`、`/edge-light` 三種進入點，是三個選項裡唯一能在現有架構、不用額外付費服務就跑起來的）。
- 過程中發現的實測 bug：`@cf-wasm/photon` 的 `rotate(img, angle)` 在 90/180/270 度時會讓部分色版的中間值（例如 RGB 的 G=200）被錯誤地推到 255，只有呼叫 `rotate()` 之後才會出現，`resize()`/`fliph()`/`flipv()` 單獨使用都正常（用暫時性的驗證腳本、比對 sharp 的 `.rotate()` 輸出逐色塊排查出來的，腳本本身完成驗證後已刪除，不留在 repo 裡）。因為 90/180/270 度旋轉本質上只是精確的像素座標搬移、不需要任何插值，改成直接對 `PhotonImage.get_raw_pixels()` 的 raw RGBA buffer 手動做座標搬移（`rotate90Cw()`），再用 `new PhotonImage(pixels, width, height)` 建回物件，完全繞開 `rotate()`；`fliph()`/`flipv()`（單純鏡射，沒有插值）維持用套件原生函式。已用比對 sharp `.rotate()` 輸出的方式驗證全部 8 種 EXIF orientation 值（1–8）、以及旋轉後還需要再縮放的情境，色塊位置與色值都與 sharp 的既有行為一致（僅有 JPEG 解碼器本身的 1–2 個色階差異，非旋轉邏輯問題）。EXIF orientation tag 本身 `photon` 沒有內建解析，`src/lib/image-processing.ts` 另外手刻了一個只讀 `0x0112` tag 的最小 TIFF/Exif 解析器（只處理 JPEG，PNG/WebP 上傳實務上幾乎不帶方向 EXIF）。
- 已知取捨（非 bug，是功能落差）：`get_bytes_webp()` 只支援無損 webp，沒有像 `sharp` 那樣的有損品質參數（先前是 quality 82），輸出檔案會比之前大。SPEC §12.1/§12.2 只寫「重新編碼為 webp、去除 EXIF、最長邊 1200px」，沒有規定要有損壓縮或指定檔案大小門檻，所以這個取捨沒有違反 SPEC 文字，但值得記錄：如果之後量測到圖片載入效能是瓶頸，可以考慮換成 `get_bytes_jpeg(quality)`（`photon` 支援品質參數，但格式變成 jpeg 不是 webp）或改接 Cloudflare Images（正式的有損壓縮＋按裝置變體，但要另外付費啟用）。
- 影響範圍：`src/lib/image-processing.ts`、`tests/image-processing.test.ts`（改用 `PhotonImage` 直接產生測試用圖片，不再依賴 `sharp`；新增手刻 EXIF APP1 段的測試 fixture 產生器，驗證 orientation 校正行為）、`package.json`（移除 `sharp`，新增 `@cf-wasm/photon`）。

### 本機開發用資料庫換成 Supabase；改用 Session pooler，且測試套件維持連本機 Postgres
- 里程碑：M6（部署嘗試期間追加）
- 問題：使用者在 Supabase 開了一個免費專案，決定先只把「本機開發用」的 DATABASE_URL 換過去（Workers 部署所需的連線層——Hyperdrive／serverless driver——留到之後再處理，見上面「Prisma 目前用 `@prisma/adapter-pg`」那條）。實際串接時遇到兩個問題：(1) Supabase 專案設定頁的「Direct connection」主機名稱（`db.<ref>.supabase.co:5432`）只解析得到 IPv6 位址，這個開發環境沒有 IPv6 對外連線能力，`prisma migrate status` 直接噴 `P1001: Can't reach database server`；(2) 換成走 Session pooler（`aws-0-<region>.pooler.supabase.com:5432`，IPv4 可達）連上之後，`npm run test` 有兩個測試失敗——`pickup-number.test.ts` 的 200 筆併發交易撞到 Prisma transaction 逾時、`stats-rebuild.test.ts` 撞到 Vitest 預設的 5 秒測試逾時，原因是這兩個測試對「DB 回應要夠快」的假設是針對本機 docker Postgres（幾乎零延遲）寫的，換成跨區網路（session pooler 在東京）之後每一次來回都多了實際的網路延遲，200 筆併發交易疊加起來就超時了。
- 暫定假設：(1) 連線一律用 Supabase 的 **Session pooler**，不用 Direct connection——這不只是繞開這個環境的 IPv6 限制，Session pooler 本身也比較貼近一般 serverless/edge 部署會遇到的網路狀況（沒有固定的長連線），比 Direct connection 更適合當作「之後要接 Workers」的預備動作。(2) 測試套件**不**跟著 `.env` 換成 Supabase——`tests/setup.ts` 改成先讀 `.env`（拿到 `NEXTAUTH_SECRET`／`STORAGE_*` 等其餘共用變數），再用新增的 `.env.test`（gitignore 排除，本機專用，內容是本機 docker Postgres 的預設帳密）覆蓋 `DATABASE_URL`，讓 `npm run test` 固定連本機、不受遠端網路延遲影響、也不會拿測試資料（尤其是併發配號測試會製造大量假訂單）去污染 Supabase 上的開發資料。新增 `.env.test.example`（已加進 `.gitignore` 的例外名單）讓其他協作者知道有這個機制。這個決定的權衡：如果之後要驗證「連 Supabase 時測試套件本身的效能表現」，需要另外調高那兩個測試的逾時時間或設計專門的效能測試，不在這次的範圍內。
- 影響範圍：`.env`（本機，未進版控，DATABASE_URL 換成 Supabase session pooler）、`.env.test`（新增，未進版控，本機 docker Postgres）、`.env.test.example`（新增）、`tests/setup.ts`、`.gitignore`。

### 移除 `src/proxy.ts`，把裡面做的事分散到不需要 middleware 的地方
- 里程碑：M6（部署嘗試期間追加）
- 問題：接上 Hyperdrive 準備部署到 Cloudflare Workers 時，用 `npm run cf:build` 驗證，撞到 `ERROR Node.js middleware is not currently supported`。查 Next.js 16 官方文件確認：`proxy.ts`（新版 Middleware，取代舊的 `middleware.ts`）**架構性地**宣告為 Node.js runtime，`runtime` config 選項在 Proxy 檔案裡完全不能用（設定了會直接拋錯），跟檔案裡 import 什麼無關。用對照實驗驗證過：把 `src/proxy.ts` 改回引用未拆分的完整版 `auth.ts`，重新建置噴出一字不差的同一個錯誤——證實先前「拆分 `auth.config.ts`／`auth.ts`」那次修復解決的是另一件事，不是這個問題（見上面「`auth.ts` 拆成…」那條的更正說明）。這是 Next.js 16 新 Proxy 架構與 `@opennextjs/cloudflare` adapter 之間的已知生態相容性落差（[cloudflare/workers-sdk#13937](https://github.com/cloudflare/workers-sdk/issues/13937)、[#13755](https://github.com/cloudflare/workers-sdk/issues/13755)，皆無官方修復），沒有辦法透過調整程式碼讓 `proxy.ts` 這個檔案本身在 Workers 上建置成功。
- 解法：Next.js 16 對 Node.js runtime 的限制**只綁定在 `proxy.ts` 這個檔案慣例本身**，不影響一般的 Server Component、Layout、Route Handler、或 `next.config.ts` 的宣告式設定——用最小改動先驗證過這個假設（暫時整個移除 `proxy.ts`，`cf:build` 一路跑完、成功產生 `.open-next/worker.js`），確認可行後才動手把原本塞在 `proxy.ts` 裡的四件事分散出去：
  1. **後台 `/admin/*` 登入檢查**：搬到 `src/app/admin/(dashboard)/layout.tsx`，直接呼叫 `auth()` + `redirect("/admin/login")`；`/admin/login` 不在 `(dashboard)` route group 內，不受影響。
  2. **安全標頭**（CSP／X-Content-Type-Options／Referrer-Policy／X-Frame-Options／HSTS）：搬到 `next.config.ts` 的 `headers()` async function——這幾個標頭本來就是靜態值（`isProduction` 在 build time 就固定，不是依請求內容動態決定），天生適合宣告式設定。刪除 `src/lib/security-headers.ts`（不再被任何地方使用）。
  3. **requestId**：簡化成只在唯一還在用的地方（webhook 簽章失敗告警）用 `?? randomUUID()` 自己 fallback，見上面「requestId 只貫穿到 route handler 層」條目的更新說明。
  4. **根路徑 `/` 的語言協商＋重定向**（SPEC §4.2：依 `Accept-Language` 協商後 302 導向、無法匹配則導 `/zh-TW`、手動切換寫入的 `NEXT_LOCALE` cookie 優先權高於 `Accept-Language`）：新增 `src/app/page.tsx`，自己讀 cookie／`headers()` 做協商後 `redirect()`。協商演算法**沒有自己發明**，直接用 `negotiator` + `@formatjs/intl-localematcher`——這正是 `next-intl` 內部本來就在用的兩個套件（間接依賴，這次明確升級成本專案自己的直接 dependency），確保跟原本 middleware 版本行為一致。查證過 next-intl 官方文件：動態（非 static export）App 官方沒有提供「不用 middleware」的現成方案維持 URL 前綴路由＋自動偵測，這個 `app/page.tsx` 是自己刻的，不是套件功能。
  5. `LocaleSwitcher`（語系切換下拉選單）本身用 `next-intl/navigation` 的 `createNavigation` helper，是純 client-side 路由＋自己設定 cookie，完全不依賴 middleware，不受影響。`/admin`、`/dev/**`、`/api/**` 這些不帶語系前綴的路徑，是獨立路由目錄（不在 `app/[locale]/**` 底下），移除 middleware 後不需要額外處理。
  6. `src/auth.config.ts`（原本只給 middleware 用的輕量 Auth.js 設定）唯一消費者是 `proxy.ts`，一併刪除，內容合併回 `src/auth.ts`。
- 驗證：typecheck／lint／test（82/82）全過；瀏覽器手動驗證根路徑重定向（含用 `curl` 帶不同 `Accept-Language`／`Cookie: NEXT_LOCALE=` 組合，確認協商結果與優先權跟 SPEC 一致）、後台登入保護（未登入 307 導向 `/admin/login`，`/admin/login` 本身 200 不落入迴圈；登入後可進 `/admin/orders`／`/admin/products`／`/admin/stats`）、安全標頭（`curl` 檢查全部標頭都在）、四語系菜單頁、`/dev/mock-pay`、`/api/v1/menu`、`/api/health` 都正常；最後重跑 `npm run cf:build`，整個建置一路跑完、無任何 middleware 相關錯誤。
- 影響範圍：`src/proxy.ts`（刪除）、`src/auth.config.ts`（刪除，內容併回 `src/auth.ts`）、`src/lib/security-headers.ts`（刪除）、`src/app/page.tsx`（新增）、`src/app/admin/(dashboard)/layout.tsx`、`next.config.ts`、`src/app/api/v1/payments/webhook/[provider]/route.ts`、`package.json`（新增 `negotiator`、`@formatjs/intl-localematcher` 為直接依賴）。

### 建立真正的 Hyperdrive 資源；`wrangler types` 預設會把 Node.js 全域型別搞爛
- 里程碑：M6（部署嘗試期間追加）
- 問題：使用者親自跑 `npx wrangler login`（瀏覽器 OAuth 授權）＋ `npx wrangler hyperdrive create <NAME> --connection-string=...` 建立了真正的 Hyperdrive 資源（上游接 Supabase 的 Direct connection）。過程中連線字串一開始噴 `ERROR Invalid URL`——原因跟先前 `.env` 遇到的一樣：Supabase 密碼裡的字面 `?` 在 URL 裡是保留字元，要 percent-encode 成 `%3F` 才能放進 connection string。拿到真實 id 填進 `wrangler.jsonc` 後，跑 `npm run cf:typegen`（`wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts`）想把先前手寫的 placeholder 型別換成正式版本，結果整個 `npm run typecheck` 炸出二十幾個錯誤，全部是「`Buffer`/`fetch` 相關方法不存在」——`wrangler types` 預設（`--include-runtime` 預設 `true`）會把完整的 Cloudflare Workers runtime 全域型別（`@cloudflare/workers-types` 的內容）內嵌進產生的檔案，而 Workers 版的 `Buffer`／`Request`／`Response` 等全域型別跟 Node.js（`@types/node`）版本的定義衝突，覆蓋掉本機開發用得到的 Node.js API 型別（例如 `src/lib/image-processing.ts` 用的 `buffer.equals()`／`buffer.readUInt16BE()` 這些 Node.js Buffer 方法，在 Workers 版型別裡不存在）。這正是先前選擇「手寫精簡版 placeholder，只宣告 `CloudflareEnv.HYPERDRIVE`」而不是一開始就跑 `wrangler types` 的原因——只是這次終於要換成正式版本，才踩到這個問題。
- 解法：跑 `npx wrangler types --help` 查到 `--include-runtime`（預設 `true`）這個 flag，把 `package.json` 的 `cf:typegen` script 改成帶 `--include-runtime=false`。重新產生的 `cloudflare-env.d.ts` 只含 `CloudflareEnv` 介面（`HYPERDRIVE: Hyperdrive`、`ASSETS: Fetcher`，及各環境變數字串型別），不再內嵌完整 runtime 全域型別；`Hyperdrive`／`Fetcher` 這兩個型別名稱本身仍能正確解析（來自 `@opennextjs/cloudflare` 的間接型別依賴，不需要額外 import），`Buffer` 等 Node.js 全域型別不受影響。跑 `npm run typecheck`／`lint`／`test`（82/82）全部恢復乾淨，`npm run cf:build` 重新驗證一次仍然完整成功。
- 影響範圍：`wrangler.jsonc`（`hyperdrive[0].id` 換成真實 id）、`cloudflare-env.d.ts`（改由 `wrangler types --include-runtime=false` 產生，不再手寫）、`package.json`（`cf:typegen` script 加上 `--include-runtime=false`）。

### 移除 middleware 後，next-intl 判斷「目前 locale」的機制本身也壞了（不只是根路徑重定向）
- 里程碑：M6（部署嘗試期間追加，push 前的全面複查時發現）
- 問題：使用者要求在 push 前「全面再檢查一遍」，跑 `npx playwright test`（四語系 E2E）驗證，結果 en/ja/ko 三個語系全部失敗——「加入購物車」後被導到 `zh-TW/cart` 而非對應語系的 cart 頁面。這揭露了先前「移除 `src/proxy.ts`」那次分析**不完整**：當時只識別出 middleware 做的「四件事」（admin guard／安全標頭／requestId／根路徑重定向），但漏掉了 next-intl 內部有兩條完全獨立、都預期 middleware 存在的「目前 locale 從哪裡來」路徑：
  1. `NextIntlClientProvider`（`app/[locale]/layout.tsx`）沒有明確傳 `locale` prop，讓它退回自動偵測——client 端的 `useRouter()`／`Link` 等 navigation helper 因此把「目前 locale」判斷成 `defaultLocale`（zh-TW），不管實際 URL 是什麼。
  2. `i18n/request.ts` 的 `getRequestConfig` 用了 `requestLocale` 參數——查證 next-intl 官方文件證實：這個值「typically corresponds to the `[locale]` segment that was matched by **the middleware**」，官方文件明講這是 legacy 用法，且沒有 middleware 時沒有可靠來源。這個更根本，直接決定**載入哪個 `messages/{locale}.json`**——即使 (1) 修好了，直接訪問 `/ja/checkout` 這種完整頁面載入（非 client-side 路由跳轉）時，畫面顯示的還是中文，因為 `NextIntlClientProvider` 沒有明確傳 `messages` prop 時，會自動用 `getRequestConfig` 解析出的（判斷錯誤的）messages。這兩條路徑各自獨立、都要修，只修一條看起來會像是「有時候對、有時候不對」的詭異現象。
  這次踩到才理解：next-intl 的 middleware 做的事，比先前以為的「路徑重寫／重定向」更底層——它同時是 App Router 裡「目前請求對應哪個 locale」這件事的唯一真相來源，一旦拿掉，這個資訊要嘛靠 URL 路徑本身重新推導（Next.js 原生機制，不靠 middleware），要嘛整個機制找不到依據、fallback 到預設值。
- 解法：
  1. `app/[locale]/layout.tsx`：`<NextIntlClientProvider locale={locale}>`，`locale` 直接來自 `layout.tsx` 本身已經有的 `props.params.locale`（Next.js 原生路由機制，不依賴 middleware）。
  2. `i18n/request.ts`：改用 Next.js 16.3+ 的 `next/root-params`（`import { locale } from "next/root-params"`，`await locale()` 回傳 `Promise<string | undefined>`）取代 `requestLocale` 參數——這是 next-intl 官方目前建議、專門為了「不透過 middleware 也能在 `getRequestConfig` 拿到路由的 `[locale]` 動態區段值」設計的 API（型別是 build time 由 Next.js 根據實際的 `app/[locale]/...` 資料夾結構產生到 `.next/types/root-params.d.ts`，具名 export `locale` 對應資料夾名稱）。查證時特別注意：不能只信 WebFetch 摘要的 `import * as rootParams from 'next/root-params'` 寫法，直接讀了專案自己 build 產生的 `.next/types/root-params.d.ts` 確認精確簽名後才動手改。
- 驗證：修完後直接訪問 `/ja/checkout`（完整頁面載入，非 client 導航）正確顯示日文；重跑 `npx playwright test`，四語系＋統計頁 5 個測試**全部通過**（先前只跑過零星的手動瀏覽器操作，沒有測到「直接訪問非預設語系頁面」這個情境，才會漏掉）。這是使用者主動要求全面複查、而不是只信任 typecheck/lint/test 綠燈就 push，才抓到的問題——`npm run test`（Vitest 單元/整合測試）完全不會碰到這塊，因為它測的是 server 端商業邏輯，不會渲染 React 元件或跑瀏覽器導航。
- 影響範圍：`src/app/[locale]/layout.tsx`、`src/i18n/request.ts`。

### `opennextjs-cloudflare build` 找不到 `pg-cloudflare`；根因是 Cloudflare Dashboard 的 Build command 設錯、外加 Next.js 檔案追蹤機制的已知 bug
- 里程碑：M6（push 後、Cloudflare Dashboard 實際自動部署時發現）
- 問題一（Dashboard 設定）：push 後 Cloudflare Dashboard 觸發自動部署，log 顯示 `Executing user build command: npm run build`（純 `next build`）接著 `Executing user deploy command: npx wrangler deploy`，後者偵測到是 OpenNext 專案、呼叫 `opennextjs-cloudflare deploy`，卻噴 `ERROR Could not find compiled Open Next config`。查證 Cloudflare 官方文件確認：**Workers Builds（Dashboard 的 Git 整合式 CI）不會讀 `wrangler.jsonc` 的 `build.command` 欄位，只認 Dashboard 上 Settings → Build 頁面設定的值**，沒有辦法用 repo 內的檔案控制。原因是 Dashboard 的 Build command 被設成 `npm run build`（只跑 `next build`），沒有跑到 OpenNext 專屬的建置步驟（`opennextjs-cloudflare build`），所以 `wrangler deploy` 要用的 `.open-next/` 產物根本沒被產生過。**解法：使用者自己到 Dashboard 把 Build command 改成 `npx opennextjs-cloudflare build`**（這步驟只能在 Dashboard 操作，repo 裡沒有對應設定）。
- 問題二（`pg-cloudflare` 打包失敗）：Build command 改對後進到 OpenNext 打包階段，噴 `✘ [ERROR] Could not resolve "pg-cloudflare"`（`.open-next/server-functions/default/node_modules/pg/lib/stream.js` 裡的 `require('pg-cloudflare')` 解析不到）。排查過程：
  1. 一開始懷疑是 `pg-cloudflare@1.4.0` 這個 npm 套件本身發布時漏了 `dist/index.js`（社群有一個對應的 open GitHub issue，摘要看起來像是這樣）。裝了 `patch-package` 想手動補檔案，結果 `npx patch-package pg-cloudflare` 回報「沒有偵測到任何差異」——證實這個假設是錯的，npm registry 上的套件本身是完整的。
  2. 重新用本機 `cf:build` 重現問題，直接檢查中間產物 `.open-next/server-functions/default/node_modules/pg-cloudflare/dist/`，發現裡面只有 `empty.js`，沒有 `index.js`——問題出在 **OpenNext／Next.js 自己複製依賴檔案這一步**，不是套件本身。
  3. 找到真正對應的 GitHub issue（[brianc/node-postgres#3349](https://github.com/brianc/node-postgres/issues/3349)），`@opennextjs/cloudflare` 維護者 `vicb` 在留言裡確認根因：`pg-cloudflare` 的 `package.json` 用 conditional exports（`workerd` vs `default` 兩個分支各指向不同檔案），Next.js 打包 server 端程式碼時的檔案追蹤（file tracing）機制預設只認 Node.js condition，只會複製 `default` 分支對應的 `dist/empty.js`，漏掉 `workerd` 分支需要的 `dist/index.js`；到了 esbuild 打包階段（這步認得 `workerd` condition）才發現檔案不在，此時已經來不及。
  4. 查 OpenNext 官方 troubleshooting 文件，確認這是一類已知、有文件記載的問題（「`Could not resolve "<package>"` 可能是套件含 workerd 專屬程式碼」），指向官方的 [workerd howto](https://opennext.js.org/cloudflare/howtos/workerd)：解法是把這類套件加進 `next.config.ts` 的 `serverExternalPackages`，讓 Next.js 完全不去追蹤/打包這些套件的內部依賴，交給 runtime 自己去正確解析 conditional exports。官方已知清單裡有 `postgres`（另一個 Postgres driver）但沒有列 `pg`／`pg-cloudflare`，這次算是補上這個案例。
- 解法：`next.config.ts` 加 `serverExternalPackages: ["pg", "pg-cloudflare", "@prisma/client", ".prisma/client"]`。重跑 `npm run cf:build`，這次 `.open-next/server-functions/default/node_modules/pg-cloudflare/dist/` 底下正確含 `index.js`（跟原始 `node_modules/pg-cloudflare/dist/index.js` 一致，5044 bytes），整個建置一路成功。`typecheck`／`lint`／`test`（82/82）／`next build`／`cf:build` 全部重新驗證過。
- 影響範圍：`next.config.ts`。使用者需要自行處理的部分（不在 repo 範圍內）：Cloudflare Dashboard 的 Build command 設定。

### `opennextjs-cloudflare deploy` 要求提供 Hyperdrive 的 `localConnectionString`，即使是正式部署
- 里程碑：M6（`pg-cloudflare` 修好後，同一次部署 log 裡緊接著出現的下一個錯誤）
- 問題：`pg-cloudflare` 修好、build 階段完整成功後（log 明確顯示 `Success: Build command completed`），接著 `Executing user deploy command: npx wrangler deploy` 這步噴：`UserError: When developing locally, you should use a local Postgres connection string to emulate Hyperdrive functionality. Please setup Postgres locally and set the value of the 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE' variable or "HYPERDRIVE"'s "localConnectionString"...`。呼叫堆疊指向 `getPlatformProxy`（wrangler／Miniflare 提供、設計給「本機模擬 Cloudflare 環境」用的 API），是 `@opennextjs/cloudflare` 的 `deployCommand` 內部呼叫 `getEnvFromPlatformProxy` 觸發的——但這次是**正式部署**（`opennextjs-cloudflare deploy`），不是 `wrangler dev`，理論上不該需要「本機模擬用」的連線字串。查證 Cloudflare 官方 Hyperdrive 文件確認：`localConnectionString` 這個欄位**只有 `wrangler dev`（本機開發）會真的拿去連線**，`wrangler dev --remote` 不會用、正式部署（`wrangler deploy`）更不會用——但 OpenNext 的 deploy 流程實作上，還是會觸發這個欄位「必須存在」的檢查（即使填了的值實際上不會被拿去做任何連線）。
- 解法：`wrangler.jsonc` 的 hyperdrive binding 加上 `localConnectionString`，填本機 docker Postgres 的連線字串（`postgresql://flourflour:flourflour@localhost:5432/flourflour`）——純粹是為了讓這個檢查通過，不影響正式環境實際的資料庫連線行為（正式流量走的是 `id` 對應的真正 Hyperdrive 資源）。驗證方式：`npx wrangler deploy --dry-run` 沒有觸發到原本失敗的那條程式碼路徑（走的是 wrangler 自己的一般部署流程，不會呼叫 `getPlatformProxy`）；改用 `npx opennextjs-cloudflare deploy --dryRun` 精確重現 Cloudflare Dashboard 那次失敗用的確切指令路徑，這次順利跑完、無報錯，確認修法有效。
- 影響範圍：`wrangler.jsonc`。

### 正式站 500：Prisma 7 的 wasm query compiler 在 workerd 上完全無法執行期載入（未解決）
- 里程碑：M6 之後（2026-08-16 事故：使用者回報正式站打不開，`curl` 確認每個會碰 DB 的路由都回 500）
- 問題：Prisma 7 搭配 driver adapter（`@prisma/adapter-pg`）時，負責把查詢編譯成 SQL 的「query compiler」是一個 wasm 模組，必須在執行期取得編譯好的 `WebAssembly.Module`。workerd（Cloudflare Workers runtime）基於安全考量，**完全不提供任何執行期 wasm 編譯 API**——`new WebAssembly.Module()` 會拋 `CompileError: Wasm code generation disallowed by embedder`；`WebAssembly.compileStreaming`／`WebAssembly.compile` 在 workerd 上根本不存在（`TypeError: ... is not a function`）。唯一合法方式是「部署時」就編譯好、以真正的靜態 ES module import 綁定，執行期完全不呼叫任何 WebAssembly.* API。試過四種修法，全部失敗：
  1. **`prisma generate` 預設輸出**（base64 內嵌 + `new WebAssembly.Module()`）→ `CompileError: Wasm code generation disallowed by embedder`。
  2. **generator 加 `runtime = "workerd"`**（Prisma 官方為此情境設計的選項，改產生靜態 `import("./x.wasm?module")`）→ Next.js 16.3.1 的 Turbopack 會把這個靜態 import 轉譯成執行期用 `WebAssembly.compileStreaming()` 動態編譯的 loader（`[turbopack-wasm]/node/loadWasm.ts`），完全繞不過去；而且發現 Turbopack 針對不同 chunk 用了兩種不同的內部 wasm loader 實作（`loadWebAssemblyModule`/`loadWebAssembly` vs 內嵌的 `compileModule`），`@opennextjs/cloudflare@1.20.2`（目前最新版）內建的修補（`patches/plugins/turbopack.js` 的 `patchTurbopackRuntime`）只涵蓋前者、涵蓋不到 Next 16.3.1 這個新的 `compileModule` 形式，是 OpenNext adapter 落後於 Next.js 新版 Turbopack 分包方式的真實落差。
  3. **`wrangler.jsonc` 的 legacy `wasm_modules` binding**（讓 Cloudflare 部署時編譯好，執行期直接從 `env` 拿）→ workerd 直接拒絕啟動：`"PRISMA_QUERY_COMPILER_WASM" is a Wasm binding, but Wasm bindings are not allowed in modules-based scripts`（本專案的 Worker 是 ES modules 格式，legacy binding 明確不支援）。
  4. **把 Prisma 產生的檔案標成 `serverExternalPackages`（不讓 Turbopack 打包）**——先在 `src/generated/prisma` 底下手動塞一個 `package.json` 冒充套件，無效（Turbopack 仍打包/轉譯，未真正 external）；改把 `output` 真的搬到 `node_modules/@internal/generated-prisma-client` 底下再試，這次 Turbopack 直接建置失敗：一是對 `node_modules` 底下的 `.ts` 原始碼回報 `Unknown module type`（Turbopack 預期 node_modules 內容已是編譯過的 JS，不會對其套用 TS loader）；二是本專案慣用的 `@/*` path alias 跟 Turbopack 的 scoped-package 判斷邏輯衝突（`Package @ can't be external`，把 `@/generated/prisma/enums` 誤判成 npm scoped package `@`）。
- 暫定假設：**先撤銷所有嘗試 2–4 的變更**，只保留 generator 的 `runtime = "workerd"` + `compilerBuild = "small"`（語意上仍是對的設定，即使單獨無法解決問題），讓 repo 回到「至少 build 得過、但正式站仍是 500」的乾淨狀態，不留半成品 hack。這是目前找到的、Next.js 16.3.1（Turbopack）+ Prisma 7（wasm query compiler）+ `@opennextjs/cloudflare@1.20.2` 三者組合下的真實上游相容性缺口，不是靠應用層程式碼能繞開的問題。
- **後續追加嘗試 5：`next build --webpack`**（使用者選定的方向）——先修好一個連帶發現的既有問題：`src/app` 底下 `admin`／`dev`／`[locale]` 三個頂層路由各自獨立宣告 `<html>/<body>`（刻意讓後台固定 zh-TW、顧客端依語系動態 `lang`），卻沒有用 Next.js 「多重 root layout」正規做法（route group），導致沒有任何 `app/layout.tsx`。Turbopack 的建置期驗證沒抓到這個問題，`next build --webpack` 的驗證器會擋（`page.tsx doesn't have a root layout`）。已改用 route group 正規解法修好（`admin`→`(admin)/admin`、`dev`→`(dev)/dev`、`[locale]`→`(storefront)/[locale]`、根目錄 redirect page→`(root)/page.tsx` + 新增最小的 `(root)/layout.tsx`；URL 完全不受影響，因為 route group 資料夾不會出現在網址上）——**這個修正本身是正確的，已保留**，跟 Turbopack 主線建置相容（已驗證 `next build` 不帶 `--webpack` 一樣能過）。
  修好 root layout 後，webpack 換一個錯誤擋下：wasm 預設要手動開 `experiments.asyncWebAssembly`（已在 `next.config.ts` 加 `webpack()` 設定），開了之後 build 真的成功、也真的把 wasm import 轉成靜態 import（`.open-next` 產物裡完全找不到 `compileStreaming` 了）——但換成另一個**同樣致命、成因完全不同**的問題：Next.js 針對 Node.js target 產生的 webpack wasm loader 用的是 `require("fs").readFile(path.join("", "static/wasm/"+hash+".wasm"))` 讀取「執行當下同目錄的實體檔案」，這個假設在 Cloudflare Workers 上不成立——workerd 根本沒有真正的檔案系統；就算手動把遺失的 `.wasm` 檔複製進 `.open-next` 部署包裡對應路徑，workerd 的 nodejs_compat 虛擬檔案系統仍然找不到（`no such file or directory, readAll '/bundle/static/wasm/...'`），因為 wrangler 自己的靜態打包分析（esbuild）只認得得了到的靜態 import，認不出這種「執行期字串拼接組出路徑再動態 require」的寫法，不會把該檔案打進部署包能被找到的位置。
  結論：**Turbopack（wasm import 被轉譯成呼叫不存在的 `WebAssembly.compileStreaming`）與 webpack（wasm 載入假設有真實檔案系統）兩條路都已證實走不通，且是兩個完全不同的根因**，不是切換 bundler 就能繞過的問題。已還原 `package.json` 的 `build` script 回 `next build`（不帶 `--webpack`）與 `next.config.ts` 的 `webpack()` 設定，只留下 route group 重構這個正確性修正。
- 已知但尚未嘗試、供下次接手參考的方向：(a) 暫時降級 Next.js 到 15.x（`@opennextjs/cloudflare` 官方文件/社群案例多半是在這個版本線測過，Turbopack 分包方式較舊、OpenNext 的修補程式較可能涵蓋到）；(b) 回報 `opennextjs-cloudflare` 上游 issue（GitHub `opennextjs/opennextjs-cloudflare`）並等待官方跟上 Next 16 Turbopack 的新分包方式；(c) 查是否有不需要 wasm query compiler 的 Prisma 7 driver adapter 替代方案（初步查了 `@prisma/adapter-pg-worker`，但目前最新版只到 6.9.0，不支援 Prisma 7 架構，此路目前不通）。
- 影響範圍：`prisma/schema.prisma`（保留 `runtime = "workerd"`）；`wrangler.jsonc`／`next.config.ts`／`tsconfig.json`／`src/lib/db.ts`／`prisma/seed.ts`／`package.json` 的 build script 均已還原至事故前等效狀態；`src/app` 路由結構重構為 route group（`(admin)`／`(dev)`／`(storefront)`／`(root)`）已保留，網址不變；**正式站在此問題解決前持續回應 500，所有會碰資料庫的路由（含首頁菜單）都無法使用**。

### 正式站圖片上傳 500：`@cf-wasm/photon` 的 workerd 進入點在 Next.js bundler 下建置期就失敗（已解決）
- 里程碑：M6 之後（2026-08-17，Drizzle 遷移＋R2 接上之後，實測 `/api/v1/admin/uploads` 才發現）
- 問題：`src/lib/image-processing.ts` 固定 `import ... from "@cf-wasm/photon/node"`。`/node` 進入點在呼叫時才動態 `new WebAssembly.Module()`，這件事在 Node.js 沒問題，但在 Cloudflare Workers（workerd）被禁止——用 `wrangler tail` 抓到正式站真正的錯誤是 `CompileError: Wasm code generation disallowed by embedder`，跟前面 Prisma 那次是同一類限制（workerd 只允許部署時就編譯好、以靜態 ES module import 綁定的 wasm，執行期不能呼叫任何 `WebAssembly.*` API）。套件本身有提供 `/workerd` 進入點（用靜態 `import wasmModule from "*.wasm"`，理論上符合 workerd 的要求），但試過的修法全部在**建置階段**就失敗：
  1. **改用不指定子路徑的 bare import**（讓 package.json 的 conditional exports 依 runtime 自動選擇）→ 建置成功，但因為 `next build` 本身是在 Node.js 底下跑，用的是 Node 的 export condition，跟正式站要用的 workerd 沒有關係，實際仍解析成 `/node`，正式站行為完全沒變、還是同一個 CompileError。
  2. **改用 `src/db/client.ts` 同樣的「執行期偵測 Cloudflare Workers、動態 `import()` 對應子路徑」模式**（兩條路徑各自是固定字串，讓 bundler 能各自靜態打包進去）→ Turbopack 建置期直接炸：`Error: Export default doesn't exist in target module`，指向 `dist/workerd.js` 的 `import photonWasmModule from "./lib/photon_rs_bg.wasm"`。Turbopack 的 wasm module 解析邏輯不認得這種 wasm-bindgen 產生的「當普通 ES module 匯入、預期有 default export」寫法。
  3. **改用 `next build --webpack`**（比照前次 Prisma 那次的嘗試方向）→ 一開始報「webpack 5 預設不啟用 WebAssembly」，加上 `experiments.asyncWebAssembly: true` 後換一個新錯誤：`does not contain a default export`（webpack 的 async wasm module 只提供具名 exports，不是 default export，跟套件程式碼的假設不符）；同時還有另一個獨立的 `Can't resolve './photon_rs_bg.js'` 解析錯誤（wasm-bindgen 產生的配套 JS 檔案，webpack 找不到）。
  4. **把 `@cf-wasm/photon` 標成 `serverExternalPackages`**（比照專案裡 `pg`/`pg-cloudflare` 那次成功的解法）→ 仍然失敗，Turbopack 在 externals tracing 階段（要先分析清楚 external 套件內部依賴才能正確 external 化）就先炸在同一個 `Export default doesn't exist` 錯誤，不像 `pg-cloudflare` 那次單純只是「別打包」就能繞過。
  這代表 `dist/workerd.js` 這個檔案本身的 wasm import 寫法，是設計給 wrangler／esbuild 原生工具鏈（真正的 Cloudflare Workers 建置流程）用的慣例，Next.js 的兩種 bundler（Turbopack、webpack）都不認得、且不論有沒有真的被打包進最終輸出，**光是被模組圖探索到就會讓整個 `next build` 失敗**——這一步發生在 OpenNext 自己的 esbuild 打包階段（很可能正確支援這種 wasm import）介入之前，繞不過去。
- **解法（治本，比照 Prisma → Drizzle 的思路：換掉有問題的依賴，而非跟 bundler 纏鬥）**：改用 Cloudflare 原生的 **Images binding**（`env.IMAGES`，`wrangler.jsonc` 加 `"images": { "binding": "IMAGES" }`）取代正式站上的 `@cf-wasm/photon`。這是 Workers runtime 內建能力，跟 R2/D1/KV 一樣是原生 binding，不經過任何 npm 套件或 wasm 打包，完全不會被 Next.js bundler 探索到、自然繞開整個問題。API 是 `env.IMAGES.input(stream).transform({width,height,fit,rotate,flip}).output({format})`，`fit: "scale-down"` 對應「最長邊 1200px、只縮小不放大」的語意，`rotate`/`flip` 對應原本手刻的 EXIF 方向校正邏輯，功能完全涵蓋。本機 Node.js 開發／測試沒有這個 binding，維持用 `@cf-wasm/photon/node`；`src/lib/image-processing.ts` 的 `reencodeToWebp()` 依 runtime 分派到 `reencodeToWebpViaImagesBinding()`（Workers）或 `reencodeToWebpViaPhoton()`（本機）。
  - **關鍵陷阱**：一開始只在函式內做 runtime 判斷分派、但檔案最上層仍是 `import ... from "@cf-wasm/photon/node"` 的靜態 import，實測部署後仍然是同一個 `CompileError: Wasm code generation disallowed by embedder`——原因是 `@cf-wasm/photon/dist/node.js` 的原始碼在**模組頂層**（import 當下，不是呼叫函式時）就執行 `new WebAssembly.Module(...)`，只要這行 import 出現在檔案最上層，Worker 載入這個模組的當下就會直接拋錯，跟後面有沒有真的呼叫到用它的函式無關。修法是把 `import` 改成函式內的動態 `import()`，包在只有本機路徑會執行到的函式裡，bundler 才會把它拆成真正延遲載入、只在被呼叫時才求值的 chunk。
  - **`ImagesBinding`／`ImageTransformer` 型別不存在**：`cloudflare-env.d.ts` 是用 `wrangler types --include-runtime=false` 產生（刻意不含完整 Workers runtime 全域型別，避免跟 Node.js 的 `Buffer`／`fetch` 等全域型別衝突，見上面 README 部署備忘 item 3 的說明），`ImagesBinding` 只是個沒有實際定義、被 `tsconfig.json` 的 `skipLibCheck: true` 放行的型別佔位符（`env.IMAGES` 實際上等同 `any`）。沒有安裝 `@cloudflare/workers-types`（會重新引發上述全域型別衝突），改成在 `src/lib/image-processing.ts` 本檔案內自行宣告用得到的最小介面（依官方 Images binding 文件的方法簽章），存取 `getCloudflareContext().env.IMAGES` 時明確 `as unknown as` 轉型進來，取代隱性的 `any`（見 CLAUDE.md「不得已時用 unknown + type guard，並註明理由」）。
  - **驗證方式**：`npm run cf:build` 確認完全不再觸碰 `@cf-wasm/photon/dist/workerd.js`（不再有任何 wasm 相關 bundler 錯誤）；部署後用 `wrangler tail` 搭配從已登入的瀏覽器分頁直接 `fetch()` 呼叫 `/api/v1/admin/uploads`（因為瀏覽器基於安全限制不能程式化設定 `<input type="file">` 的值，改用 `FormData` + `Blob` 繞過檔案選擇對話框）——先測 1×1 小圖確認端到端成功（200、正確的 R2 公開網址、正確尺寸），再測 2000×1000 的圖確認 resize 邏輯（結果正確等比縮成 1200×600），最後用 `curl` 直接打 R2 公開網址確認回傳的是合法 webp（`RIFF ... Web/P image, lossless`，`Content-Type: image/webp`）。測試用的物件已用 `wrangler r2 object delete --remote` 清掉（預設不加 `--remote` 只會刪到本機模擬的假 R2，不會動到真正的正式資料，這裡也是一個踩過的坑）。
- 影響範圍：`src/lib/image-processing.ts`（新增 `reencodeToWebpViaImagesBinding()`，`reencodeToWebpViaPhoton()` 的 photon import 改為函式內動態 `import()`）；`wrangler.jsonc`（新增 `images` binding）；`cloudflare-env.d.ts`（`npm run cf:typegen` 重新產生，新增 `IMAGES: ImagesBinding`）；`/api/v1/admin/uploads` 已在正式站實測成功；R2 相關設定（bucket `flourflour`、`STORAGE_*`/`NEXTAUTH_*`/`APP_BASE_URL`/`PAYMENT_PROVIDER`/`MOCK_WEBHOOK_SECRET`、`.env.production` 的 `STORAGE_PUBLIC_BASE_URL`）延續前一筆記錄，皆已就緒且正確。

### Hyperdrive query cache 造成短暫的讀寫不一致（已解決：關閉快取）
- 里程碑：M6 之後（2026-08-18，全面重新驗測時，用真實瀏覽器操作＋自簽 mock webhook 完整跑過一次下單→付款→後台狀態推進→統計，才發現）
- 問題：後台訂單看板點擊「開始製作」後，PATCH `/api/v1/admin/orders/{id}/status` 本身回傳的資料已正確是新狀態（`status: "PREPARING", version: 2`），但緊接著呼叫的 `mutate()`（SWR 重新 `GET /api/v1/admin/orders`）卻讀回舊資料（`status: "PAID", version: 1`），畫面看起來像操作沒生效。用 `npx wrangler hyperdrive get <id>` 查證：這個 Hyperdrive 資源的 `"caching": {"disabled": false}`——預設啟用查詢快取，寫入不會主動使新快取失效，緊接在寫入後的 SELECT 有機率讀到快取的舊結果。另外也在「刪除測試訂單後重整銷售統計頁」重現同一現象（直接查 DB 確認資料已正確刪除／回沖，但統計頁還顯示刪除前的數字），確認這不是單一頁面的巧合，是 Hyperdrive 連線層級、影響全站所有讀取的系統性行為。
- 暫定假設：**先只修正後台訂單看板這個症狀**——`advance()` 改成直接用 PATCH 回應（已確定是資料庫剛寫入的最新值）更新本地 SWR 快取（`mutate(updater, { revalidate: false })`），不再依賴緊接著的重新 GET，避免畫面「蓋回」舊狀態。**沒有**動 Hyperdrive 本身的快取設定——這是連線層級的設定，會影響全站每一個讀取路徑，不只是這一個症狀，屬於基礎設施層級的取捨（讀取效能／減少對 Supabase 的連線次數 vs. 讀寫一致性），應該由使用者決定是否要 `npx wrangler hyperdrive update <id> --caching-disabled` 整個關掉，而不是我單方面改。
- 已知還可能受影響、但這次沒有逐一修正的其他讀寫路徑（供下次接手參考）：顧客訂單狀態頁（`/[locale]/order/[orderNo]`）付款後的第一次輪詢、後台商品／規格群組編輯後立即重新讀取、任何「寫入後馬上讀回顯示」的 UI。若使用者選擇保留快取，這些地方理論上都要比照訂單看板的做法（用寫入端點的回應直接更新畫面，不要純靠重新 GET）才能徹底解決；若選擇整個關掉快取，則不需要逐一修。
- **後續實例（2026-08-18）**：上面預測的「後台商品編輯後立即重新讀取」這條路徑，真的被使用者踩到了——後台編輯商品 Slug、按「儲存草稿」後，PATCH 回應與導回的商品列表頁都正常（無錯誤），但列表頁顯示的 Slug 還是**修改前**的舊值，使用者因此誤以為「Slug 欄位不能修改」。直接查 DB 確認 PATCH 當下就已經正確寫入新值，過一段時間後重新整理列表頁也確實顯示新值——純粹是這次的快取巧合視窗。這條路徑（`ProductForm.tsx` 的 `handleSave()` → `router.push("/admin/products")` + `router.refresh()`）跟訂單看板那次的修法不同：目的地是**另一個 Server Component 頁面**（自己重新查 DB），不是同一頁的 SWR 本地快取，所以「用寫入回應直接更新本地快取」這招在這裡用不上，沒有同等簡單的單頁修法。這進一步印證：這不是單一頁面的個案，是需要每一條「寫入後導頁／重新整理」路徑各自想解法的系統性問題，逐一修的成本會持續累積。**建議重新考慮直接關閉 Hyperdrive 快取**（`npx wrangler hyperdrive update c3e4cf1358434f15a3a425b85826c342 --caching-disabled`）。
- **最終處理（2026-08-18）**：使用者確認後，直接關閉 Hyperdrive 快取——`npx wrangler hyperdrive update c3e4cf1358434f15a3a425b85826c342 --caching-disabled`，確認回應 `"caching": {"disabled": true}`。一次解決所有「寫入後讀取」路徑的一致性問題，不需要逐一修每個頁面。訂單看板那次的本地快取修法（`mutate(updater, { revalidate: false })`）予以保留，屬於正確做法、無害，只是現在已非必要。
- 影響範圍：`src/app/(admin)/admin/(dashboard)/orders/page.tsx`（先前已修正，保留）；Hyperdrive 資源 `flourflour-db`（`c3e4cf1358434f15a3a425b85826c342`）快取已關閉。

### 正式站 `PAYMENT_PROVIDER=mock` 預設值，但 `/dev/mock-pay` 頁面在正式環境被擋掉——結帳流程目前無法由顧客自行完成付款
- 里程碑：M6 之後（2026-08-18，真實走一次顧客下單流程才發現：送出訂單後被導向 `/dev/mock-pay?...`，正式站回 404）
- 問題：`src/lib/payment/registry.ts` 的 `defaultProviderCode()` 在 `PAYMENT_PROVIDER` 環境變數未設定時，**預設值就是 `"mock"`**（`process.env.PAYMENT_PROVIDER ?? "mock"`）——這不是本次調查才設定的，是程式碼本來的行為，即使完全不設定這個環境變數，正式站也一樣會用 mock provider。`MockProvider.createCharge()`（`src/lib/payment/providers/mock.ts`）不論環境一律把顧客導向 `${APP_BASE_URL}/dev/mock-pay?orderNo=...&paymentId=...` 這個頁面，但 `/dev/mock-pay` 整個路由（含頁面與其 API `POST /api/v1/dev/mock-pay`）依 SPEC.md §7.4 的設計是**刻意**只在 `NODE_ENV !== "production"` 時註冊——這是安全設計，不是疏漏：不應該讓正式站上的真實顧客能用「按一個按鈕」就讓訂單變成已付款，形同免費領取商品的漏洞。兩件事疊在一起的結果：**正式站上任何顧客現在都無法完成付款**，下單會成功（`POST /api/v1/orders` 201、建立付款 200），但送出後導向的頁面必定 404，訂單永遠卡在 `PENDING_PAYMENT`，最終被逾時 job 自動取消。
- 這不是我這次操作造成的新問題——在我於 Phase「先接 R2」時把 `PAYMENT_PROVIDER=mock` 設成正式站 secret 之前，這個環境變數本來就是空的，而空值一樣會 fallback 成 `"mock"`，行為完全相同。也就是說**只要還沒有任何一家金流廠商（綠界／藍新／TapPay）的真實串接完成，這個網站目前架構下就不可能有顧客能真正付款成功**，這是「金流廠商 API 文件尚未到位」這個已知限制的直接後果，而不是獨立的新 bug。
- 暫定假設：**不擅自變更**——是否要為了短期可用而破例讓 mock provider 在正式站也能被觸發（例如另外做一個需要管理者權限才能觸發的「模擬付款」後台功能，取代目前顧客導向的 `/dev/mock-pay` 頁面），還是就維持現狀、等待真實金流廠商串接完成才算真正可上線，是產品層級的決定，應由使用者選擇，不是程式碼正確性問題。
- 影響範圍：`src/lib/payment/registry.ts`、`src/lib/payment/providers/mock.ts`、`src/app/(dev)/dev/mock-pay/`（現況皆未變更）；`docs/VENDOR-API-CHECKLIST.md` 待廠商文件到位後的串接仍是解除此限制的正途。
