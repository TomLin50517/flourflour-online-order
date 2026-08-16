# 廠商 API 待索取清單

> 見 SPEC.md §7.6。三家候選金流廠商（ECPay 綠界 / NewebPay 藍新 / TapPay）的 adapter 骨架
> 已建立於 `src/lib/payment/providers/{ecpay,newebpay,tappay}.ts`，所有方法目前皆拋出
> `NotImplementedError`（對外回應 `503 PAYMENT_PROVIDER_NOT_CONFIGURED`）。
> 廠商文件到位後，依下列清單逐項確認並實作對應 adapter，核心訂單流程（`server/order/*`、
> `server/payment/*`）不需改動。

## 共通（三家皆需確認）

- [ ] 測試環境與正式環境 endpoint
- [ ] 商店代號（MerchantID）
- [ ] HashKey / HashIV（或 API Key / Secret，依廠商命名）
- [ ] 建立交易的完整參數表與必填欄位
- [ ] 簽章演算法與待簽字串的組成規則（含參數排序、URL encode 大小寫細節）
- [ ] Webhook（Server 端通知）的 HTTP method、Content-Type、欄位表、重送策略與次數
- [ ] 廠商交易唯一識別碼欄位名（對應本系統的 `Payment.providerRef` 與 `PaymentEvent.providerEventId`）
- [ ] 退款 API 規格：是否支援部分退款、退款時限、失敗時的錯誤碼
- [ ] 查詢交易 API 規格（`queryCharge`，供 §7.5 對帳補償 job 使用）
- [ ] 支援的付款頁語系清單（對應本系統 zh-TW / en / ja / ko）
- [ ] Webhook 來源 IP 白名單（對應 `PAYMENT_WEBHOOK_ALLOWED_IPS`）
- [ ] 是否代開電子發票；若否，需另接發票加值中心（見 SPEC.md §14.6，上線前必須確認）

## ECPay（綠界）— `src/lib/payment/providers/ecpay.ts`

- [ ] 《全方位金流》介接文件版本與串接方式（Elavon/信用卡一次付清 vs 分期）
- [ ] `CheckMacValue` 計算規則（排序、URL encode、雜湊演算法 SHA256/MD5）
- [ ] 建立訂單的必填欄位（`MerchantTradeNo` 長度限制、`ItemName` 格式等）
- [ ] `CreateChargeResult` 應對應 `FORM_POST` 模式（表單自動送出至綠界收銀台）
- [ ] Server 端付款結果通知（`ReturnURL`）與前端導回（`ClientBackURL`）的欄位差異
- [ ] 環境變數：`ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` / `ECPAY_ENDPOINT`（已在 `.env.example` 預留）

## NewebPay（藍新）— `src/lib/payment/providers/newebpay.ts`

- [ ] MPG 介接文件版本
- [ ] AES-256-CBC 加密規則（`TradeInfo`）與 SHA256 雜湊規則（`TradeSha`）
- [ ] 建立訂單的必填欄位與 `MerchantOrderNo` 格式限制
- [ ] `CreateChargeResult` 應對應 `FORM_POST` 模式
- [ ] Notify/Return 網址欄位差異、通知內容是否為加密字串
- [ ] 環境變數：`NEWEBPAY_MERCHANT_ID` / `NEWEBPAY_HASH_KEY` / `NEWEBPAY_HASH_IV`（已在 `.env.example` 預留）

## TapPay — `src/lib/payment/providers/tappay.ts`

- [ ] Fields / Pay by Prime 介接文件版本
- [ ] Prime 產生方式（前端 SDK）與後端 `pay-by-prime` API 規格
- [ ] `CreateChargeResult` 應對應 `SDK_TOKEN` 模式（`clientToken`/`sdkParams` 對應 TapPay Fields 初始化參數）
- [ ] Webhook（Server 端通知）是否存在、驗證方式（TapPay 部分整合僅靠 API 回應同步確認，需確認是否仍需被動 webhook）
- [ ] 退款 API（`refund/by-prime-transaction-id`）規格
- [ ] 環境變數：`TAPPAY_PARTNER_KEY` / `TAPPAY_MERCHANT_ID` / `TAPPAY_APP_ID` / `TAPPAY_APP_KEY`（已在 `.env.example` 預留）

## 已知會受影響的檔案（廠商文件到位後）

- `src/lib/payment/providers/{vendor}.ts` — 實作 `createCharge` / `verifySignature` / `parseWebhook` / `queryCharge` / `refund` / `resolveReturn`
- `src/lib/payment/registry.ts` — 目前已讀取對應環境變數並注入 adapter constructor，通常不需改動
- `.env.example` / `.env` — 已預留全部欄位，正式環境需填入實際值
- `docs/OPEN-QUESTIONS.md` — 若廠商文件與 SPEC.md §7.2 的介面假設有出入（例如某廠商不支援 `SDK_TOKEN` 以外的模式），需記錄暫定假設
