# 線上點單系統 — 設計規格書 (SPEC)

> 版本 v1.0 ｜ 2026-08-15 ｜ 交付對象：Claude Code
> 本文件為「實作契約」。凡未在本文件定義者，實作時須先於 `docs/OPEN-QUESTIONS.md` 提問並標註假設，不得自行擴充需求。

---

## 0. 給實作者的閱讀指引

| 章節 | 內容 | 實作時機 |
|---|---|---|
| 1–2 | 需求邊界、決策紀錄 | 動工前必讀 |
| 3 | 系統架構與技術棧 | 專案初始化 |
| 4 | 多語系設計 | M1 |
| 5 | 資料模型（Prisma Schema） | M1 |
| 6 | 訂單狀態機與取貨單號 | M3 |
| 7 | 金流抽象層（廠商 API 保留位） | M4 |
| 8 | API 契約 | M2–M4 |
| 9 | 前台頁面規格 | M2 |
| 10 | 後台頁面規格 | M3 |
| 11 | 銷售統計口徑 | M5 |
| 12 | 非功能性需求 | 全程 |
| 13 | 里程碑與驗收條件 | 全程 |
| 14 | 已識別的需求缺口與預設決策 | 動工前必讀 |

**最高原則**：任何標記 `TODO(VENDOR-API)` 的位置，代表廠商 API 文件尚未到位。實作必須做到「介面完整、型別完整、Mock 可跑通完整流程」，僅將真實 HTTP 呼叫留空並拋出 `NotImplementedError`。**不得因為 API 未定就簡化流程或跳過該環節。**

---

## 1. 需求邊界

### 1.1 In Scope

| # | 需求 | 說明 |
|---|---|---|
| R1 | 四語系前台 | zh-TW（正體中文）、en、ja、ko。UI 字串與商品內容皆須翻譯 |
| R2 | 商品呈現 | 名稱、照片、簡介、價格、數量選購；**含規格選項（尺寸／加料等）** |
| R3 | 管理後台 | 商品 CRUD 與上下架、訂單管理、每日各商品銷售量統計 |
| R4 | 線上金流 | 下單後線上刷卡（台灣金流，API 保留） |
| R5 | 取貨單號 | 付款成功後產生店內自取叫號單號 |

### 1.2 Out of Scope（v1 不做，但資料模型須預留欄位）

- 會員系統與登入（前台以訪客下單為主，訂單以 `orderNo + accessToken` 查詢）
- 優惠券 / 促銷活動 / 會員點數
- 多門市（資料模型保留 `storeId`，v1 固定單一門市）
- 外送 / 物流
- 電子發票開立（保留介面，見 §14.6）
- 即時庫存扣減（v1 僅提供「售完」手動開關）

### 1.3 使用者角色

| 角色 | 說明 | 認證方式 |
|---|---|---|
| Customer | 訪客顧客，掃 QR / 開網頁點單 | 無需登入，訂單以 accessToken 存取 |
| Staff | 門市人員，接單、叫號、改訂單狀態 | 後台帳密登入 |
| Admin | 管理者，商品維護、查看統計 | 後台帳密登入（含 Staff 全部權限） |

---

## 2. 架構決策紀錄（ADR 摘要）

| ID | 決策 | 理由 | 被否決的方案 |
|---|---|---|---|
| ADR-1 | Next.js 15 (App Router) + TypeScript 單一 repo，前後台同專案 | 減少跨專案協調成本；Server Actions/RSC 讓後台 CRUD 極省程式碼；`next-intl` 為目前最成熟的 App Router i18n 方案 | 前後端分離（增加 CORS/型別同步成本，v1 無此必要） |
| ADR-2 | PostgreSQL + Prisma | 訂單需交易一致性與 `FOR UPDATE` 序號配號；Prisma 型別安全且遷移可追蹤 | MongoDB（配號與金額結算需強一致，不適合） |
| ADR-3 | 商品多語系採「翻譯子表」而非 JSONB 欄位 | 可對單一語系建索引與做完整性檢查（缺譯偵測）；未來加語系不需改欄位 | JSONB（查詢缺譯困難、無法約束） |
| ADR-4 | 金額以**整數最小貨幣單位**儲存（`Int`） | 杜絕浮點誤差；TWD `minorUnit=0`，即 1 = NT$1 | Decimal / Float |
| ADR-5 | 金流採 `PaymentProvider` 介面 + Adapter | 廠商 API 未定，先以介面凍結上下游契約，日後只實作 adapter，不動核心流程 | 直接寫死某家 SDK |
| ADR-6 | 訂單品項儲存「價格與名稱快照」 | 商品改價／改名後，歷史訂單金額不得變動 | 只存 productId 靠 join |
| ADR-7 | 取貨單號於**付款成功**時才配發 | 避免未付款訂單佔用號碼、造成叫號斷號 | 建單即配號 |

---

## 3. 系統架構與技術棧

### 3.1 技術棧（版本為下限，實作時鎖定 lockfile）

```
Runtime      Node.js 22 LTS
Framework    Next.js 15 (App Router, RSC, Server Actions)
Language     TypeScript 5.6 (strict: true)
DB           PostgreSQL 16
ORM          Prisma 5.x
i18n         next-intl 3.x
UI           Tailwind CSS 3.x + shadcn/ui + lucide-react
Form/Valid   react-hook-form + Zod（Zod schema 為前後端共用的唯一真實來源）
Auth(後台)   Auth.js (NextAuth v5) — Credentials Provider + bcrypt
Storage      S3 相容物件儲存（開發用 MinIO；正式環境見 §12.4）
Cache        無（v1 以 Next.js `revalidateTag` 處理菜單快取）
Test         Vitest（單元）+ Playwright（E2E）
Lint         ESLint + Prettier + `tsc --noEmit`
```

### 3.2 部署拓撲

```
                ┌─────────────────────────────┐
  顧客瀏覽器 ──▶ │  Next.js App (SSR + API)     │
  後台瀏覽器 ──▶ │  /[locale]/*   前台          │
                │  /admin/*      後台          │
                │  /api/v1/*     REST API      │
                └───────┬─────────────┬────────┘
                        │             │
                 ┌──────▼─────┐  ┌────▼──────────────┐
                 │ PostgreSQL │  │ S3 相容物件儲存    │
                 └────────────┘  └───────────────────┘
                        ▲
                        │ webhook（付款結果回調）
                 ┌──────┴──────────────┐
                 │ 金流廠商 (TODO)      │
                 └─────────────────────┘
```

### 3.3 目錄結構（實作須遵循）

```
/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                     # 種子資料：4 語系範例商品 ≥ 8 筆
├── messages/                       # UI 字串
│   ├── zh-TW.json
│   ├── en.json
│   ├── ja.json
│   └── ko.json
├── src/
│   ├── app/
│   │   ├── [locale]/               # 前台（多語系）
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx            # 菜單
│   │   │   ├── product/[slug]/page.tsx
│   │   │   ├── cart/page.tsx
│   │   │   ├── checkout/page.tsx
│   │   │   └── order/[orderNo]/page.tsx
│   │   ├── admin/                  # 後台（僅 zh-TW，不做多語系）
│   │   │   ├── layout.tsx
│   │   │   ├── products/
│   │   │   ├── orders/
│   │   │   └── stats/
│   │   └── api/v1/...
│   ├── components/
│   ├── lib/
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── money.ts                # 金額計算（純函式、100% 覆蓋率）
│   │   ├── i18n/
│   │   ├── auth/
│   │   └── payment/                # §7 金流抽象層
│   │       ├── types.ts
│   │       ├── registry.ts
│   │       └── providers/
│   │           ├── mock.ts         # ✅ 完整可用
│   │           ├── ecpay.ts        # TODO(VENDOR-API)
│   │           ├── newebpay.ts     # TODO(VENDOR-API)
│   │           └── tappay.ts       # TODO(VENDOR-API)
│   ├── server/                     # 領域服務層（不含 HTTP 概念）
│   │   ├── order/
│   │   │   ├── create-order.ts
│   │   │   ├── state-machine.ts
│   │   │   └── pickup-number.ts
│   │   ├── catalog/
│   │   └── stats/
│   └── schemas/                    # Zod schemas（前後端共用）
├── tests/
├── docs/
│   ├── OPEN-QUESTIONS.md
│   └── VENDOR-API-CHECKLIST.md     # 見 §7.6
├── CLAUDE.md
└── SPEC.md
```

**分層規則**：`app/api` 只負責解析請求、呼叫 `server/*`、序列化回應；商業邏輯一律放 `server/*`，且不得 import `next/server`。

---

## 4. 多語系設計

### 4.1 語系定義

```ts
export const LOCALES = ['zh-TW', 'en', 'ja', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-TW';
```

DB enum 使用底線形式避免連字號問題：`ZH_TW | EN | JA | KO`，並提供雙向 mapping 函式於 `lib/i18n/locale-map.ts`。

### 4.2 路由

- 前台：`/{locale}/...`，**永遠帶前綴**（`localePrefix: 'always'`），避免 `/` 與 `/en` 產生重複內容 SEO 問題。
- 根路徑 `/` → middleware 依 `Accept-Language` 協商後 302 導向；無法匹配則導 `/zh-TW`。
- 使用者手動切換語系時寫入 cookie `NEXT_LOCALE`（1 年），優先權高於 `Accept-Language`。
- 後台 `/admin/*` **不做多語系**，固定 zh-TW（後台使用者為門市人員）。

### 4.3 兩類翻譯內容

| 類別 | 存放位置 | 維護者 | 缺譯處理 |
|---|---|---|---|
| UI 字串（按鈕、標題、錯誤訊息） | `messages/{locale}.json` | 開發者 | build 時檢查 4 檔 key 集合必須完全相同，缺 key 則 build 失敗 |
| 商品內容（名稱、簡介、規格名） | DB `*Translation` 表 | 店家後台 | 執行期 fallback 至 zh-TW，並在後台以「⚠ 缺 3 種語系」標示 |

### 4.4 在地化細節（不可忽略）

| 項目 | 規則 |
|---|---|
| 貨幣 | v1 一律 TWD。顯示用 `Intl.NumberFormat(locale, { style:'currency', currency:'TWD', minimumFractionDigits: 0 })`。**不做匯率換算**（避免與實際刷卡金額不符的法遵風險） |
| 日期時間 | 儲存一律 UTC；顯示一律轉 `Asia/Taipei` 後以該 locale 格式化 |
| 字型 | ja/ko 需載入對應字型子集（`next/font`），避免豆腐字 |
| 取貨單號 | **純英數（如 `A013`），四語系皆不翻譯**，確保店員叫號與顧客畫面一致 |
| 排序 | 商品排序以後台設定的 `sortOrder` 為準，不做語系字典序 |

### 4.5 messages 檔案結構（命名空間）

```json
{
  "common":   { "add": "加入", "cancel": "取消", "loading": "載入中…" },
  "menu":     { "title": "菜單", "soldOut": "已售完" },
  "product":  { "quantity": "數量", "addToCart": "加入購物車", "required": "必選" },
  "cart":     { "title": "購物車", "empty": "購物車是空的", "subtotal": "小計" },
  "checkout": { "title": "結帳", "payNow": "立即付款", "agreeTerms": "我同意服務條款" },
  "order":    {
    "pickupNumber": "取餐號碼",
    "waitingPayment": "付款完成後將顯示取餐號碼",
    "status": {
      "PENDING_PAYMENT": "等待付款",
      "PAID": "已付款",
      "PREPARING": "製作中",
      "READY": "可取餐",
      "COMPLETED": "已完成",
      "CANCELLED": "已取消",
      "REFUNDED": "已退款"
    }
  },
  "error":    { "generic": "系統忙碌，請稍後再試", "outOfStock": "部分商品已售完" }
}
```

---

## 5. 資料模型

### 5.1 Prisma Schema（實作以此為準，可調整格式但欄位語意不得變更）

```prisma
// ---------- Enums ----------
enum LocaleCode { ZH_TW EN JA KO }

enum OrderStatus {
  PENDING_PAYMENT   // 已建單，等待付款
  PAID              // 付款成功（此時配發 pickupNumber）
  PREPARING         // 製作中
  READY             // 可取餐（叫號中）
  COMPLETED         // 已取餐
  CANCELLED         // 已取消（未付款逾時或店家取消）
  REFUNDED          // 已退款
}

enum PaymentStatus { PENDING SUCCEEDED FAILED CANCELLED REFUNDED PARTIALLY_REFUNDED }

enum OptionSelectType { SINGLE MULTIPLE }   // 單選 / 複選

enum AdminRole { ADMIN STAFF }

// ---------- Store ----------
model Store {
  id            String   @id @default(cuid())
  name          String
  timezone      String   @default("Asia/Taipei")
  currency      String   @default("TWD")
  // 營業日切換時間（HH:mm，本地時間）。凌晨營業的店家用此界定「當日」
  businessDayCutoff String @default("04:00")
  // 取貨單號設定
  pickupPrefix  String   @default("A")
  pickupPadding Int      @default(3)     // A001
  pickupMax     Int      @default(999)   // 超過則回捲並換前綴，見 §6.3
  isOpen        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  categories    Category[]
  products      Product[]
  orders        Order[]
  optionGroups  OptionGroup[]
}

// ---------- Catalog ----------
model Category {
  id        String   @id @default(cuid())
  storeId   String
  slug      String
  sortOrder Int      @default(0)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  store        Store   @relation(fields: [storeId], references: [id])
  translations CategoryTranslation[]
  products     Product[]

  @@unique([storeId, slug])
  @@index([storeId, sortOrder])
}

model CategoryTranslation {
  id         String     @id @default(cuid())
  categoryId String
  locale     LocaleCode
  name       String

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  @@unique([categoryId, locale])
}

model Product {
  id          String   @id @default(cuid())
  storeId     String
  categoryId  String?
  slug        String                       // URL 用，英數，語系無關
  sku         String?                      // 店家自訂編號
  basePrice   Int                          // 最小貨幣單位；TWD 即元
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)      // 上架/下架
  isSoldOut   Boolean  @default(false)     // 今日售完（每日 cutoff 自動歸 false）
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?                    // 軟刪除；有訂單引用的商品不得硬刪

  store        Store    @relation(fields: [storeId], references: [id])
  category     Category? @relation(fields: [categoryId], references: [id])
  translations ProductTranslation[]
  images       ProductImage[]
  optionGroups ProductOptionGroup[]
  orderItems   OrderItem[]

  @@unique([storeId, slug])
  @@index([storeId, categoryId, sortOrder])
  @@index([storeId, isActive, deletedAt])
}

model ProductTranslation {
  id          String     @id @default(cuid())
  productId   String
  locale      LocaleCode
  name        String                    // 產品名稱
  description String?    @db.Text       // 簡介
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  @@unique([productId, locale])
}

model ProductImage {
  id        String  @id @default(cuid())
  productId String
  url       String                       // 物件儲存的公開 URL
  altText   String?                      // 無障礙用；可選填，缺則用 zh-TW 品名
  width     Int
  height    Int
  sortOrder Int     @default(0)
  isPrimary Boolean @default(false)      // 每個商品僅一張 true（應用層保證）
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  @@index([productId, sortOrder])
}

// ---------- Options（規格：尺寸、甜度、加料…） ----------
model OptionGroup {
  id         String           @id @default(cuid())
  storeId    String
  code       String                                 // 內部識別，如 "size"
  selectType OptionSelectType @default(SINGLE)
  minSelect  Int              @default(1)           // SINGLE 必選=1，非必選=0
  maxSelect  Int              @default(1)           // MULTIPLE 時 >1
  isActive   Boolean          @default(true)

  store        Store  @relation(fields: [storeId], references: [id])
  translations OptionGroupTranslation[]
  items        OptionItem[]
  products     ProductOptionGroup[]

  @@unique([storeId, code])
}

model OptionGroupTranslation {
  id       String     @id @default(cuid())
  groupId  String
  locale   LocaleCode
  name     String                     // 「尺寸」/「Size」/「サイズ」/「사이즈」
  group OptionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@unique([groupId, locale])
}

model OptionItem {
  id         String  @id @default(cuid())
  groupId    String
  code       String                    // 如 "large"
  priceDelta Int     @default(0)       // 可為負；加價/折抵
  sortOrder  Int     @default(0)
  isActive   Boolean @default(true)
  isDefault  Boolean @default(false)

  group        OptionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  translations OptionItemTranslation[]

  @@unique([groupId, code])
}

model OptionItemTranslation {
  id     String     @id @default(cuid())
  itemId String
  locale LocaleCode
  name   String
  item OptionItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  @@unique([itemId, locale])
}

model ProductOptionGroup {          // 商品 ↔ 規格群組（多對多 + 排序 + 覆寫必填）
  productId  String
  groupId    String
  sortOrder  Int     @default(0)
  isRequired Boolean @default(true)

  product Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  group   OptionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([productId, groupId])
}

// ---------- Order ----------
model Order {
  id            String      @id @default(cuid())
  storeId       String
  orderNo       String      @unique              // 對外訂單編號 ORD-20260815-0001
  accessToken   String      @unique              // 訪客查單憑證（32 bytes hex）
  status        OrderStatus @default(PENDING_PAYMENT)
  version       Int         @default(0)          // 樂觀鎖

  locale        LocaleCode                       // 下單當下語系（用於通知與收據）
  currency      String      @default("TWD")

  subtotalAmount Int                             // 品項小計總和
  discountAmount Int        @default(0)          // v1 恆為 0，欄位預留
  totalAmount    Int                             // = subtotal - discount

  // 取貨（店內自取叫號）
  pickupNumber  String?                          // 付款成功才配發，如 "A013"
  businessDate  DateTime?   @db.Date             // 配號所屬營業日
  pickupSeq     Int?                             // 當日序號（排序/稽核用）

  customerName  String?
  customerPhone String?
  customerNote  String?     @db.Text

  placedAt      DateTime    @default(now())
  paidAt        DateTime?
  readyAt       DateTime?
  completedAt   DateTime?
  cancelledAt   DateTime?
  cancelReason  String?
  expiresAt     DateTime                         // 未付款逾時時間（預設 placedAt + 15 分）

  store    Store       @relation(fields: [storeId], references: [id])
  items    OrderItem[]
  payments Payment[]
  events   OrderEvent[]

  @@unique([storeId, businessDate, pickupSeq])   // 同營業日序號唯一
  @@index([storeId, status, placedAt])
  @@index([storeId, businessDate])
  @@index([status, expiresAt])                   // 逾時清理 job 用
}

model OrderItem {
  id         String @id @default(cuid())
  orderId    String
  productId  String                         // 僅供關聯查詢，顯示一律用快照
  quantity   Int

  // ---- 快照（下單當下凍結，永不隨商品變更） ----
  nameSnapshot       Json      // { "ZH_TW": "珍珠奶茶", "EN": "...", "JA": "...", "KO": "..." }
  imageUrlSnapshot   String?
  unitBasePrice      Int       // 商品基礎單價
  unitOptionsPrice   Int       // 該品項所有選項加總（單份）
  unitPrice          Int       // = unitBasePrice + unitOptionsPrice
  lineTotal          Int       // = unitPrice * quantity

  order   Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product Product      @relation(fields: [productId], references: [id])
  options OrderItemOption[]

  @@index([orderId])
  @@index([productId])
}

model OrderItemOption {
  id           String @id @default(cuid())
  orderItemId  String
  optionItemId String
  groupNameSnapshot Json     // 同上，四語系
  itemNameSnapshot  Json
  priceDelta        Int

  orderItem OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  @@index([orderItemId])
}

model OrderEvent {                      // 訂單稽核軌跡
  id        String   @id @default(cuid())
  orderId   String
  fromStatus OrderStatus?
  toStatus   OrderStatus
  actorType  String                     // "SYSTEM" | "STAFF" | "PAYMENT_WEBHOOK"
  actorId    String?
  note       String?
  createdAt  DateTime @default(now())
  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, createdAt])
}

// ---------- Payment ----------
model Payment {
  id             String        @id @default(cuid())
  orderId        String
  provider       String                        // "ecpay" | "newebpay" | "tappay" | "mock"
  providerRef    String?                       // 廠商交易序號
  status         PaymentStatus @default(PENDING)
  amount         Int
  currency       String        @default("TWD")
  method         String?                       // "CREDIT_CARD" 等
  cardLast4      String?
  cardBrand      String?
  failureCode    String?
  failureMessage String?
  idempotencyKey String        @unique
  rawRequest     Json?                         // 遮蔽後的請求（不得含完整卡號/CVV）
  rawResponse    Json?
  createdAt      DateTime      @default(now())
  paidAt         DateTime?
  refundedAt     DateTime?

  order  Order          @relation(fields: [orderId], references: [id])
  events PaymentEvent[]
  @@index([orderId])
  @@index([provider, providerRef])
}

model PaymentEvent {                     // Webhook 去重與稽核
  id              String   @id @default(cuid())
  paymentId       String?
  provider        String
  providerEventId String                 // 廠商事件 ID，用於冪等
  eventType       String
  payload         Json
  signatureValid  Boolean
  processedAt     DateTime?
  createdAt       DateTime @default(now())

  payment Payment? @relation(fields: [paymentId], references: [id])
  @@unique([provider, providerEventId])   // ★ Webhook 冪等的關鍵
}

// ---------- 序號配發 ----------
model PickupCounter {          // 取餐號序號（付款成功時遞增）
  storeId      String
  businessDate DateTime @db.Date
  lastSeq      Int      @default(0)
  updatedAt    DateTime @updatedAt
  @@id([storeId, businessDate])
}

model OrderNoCounter {         // 訂單編號序號（建單時遞增，與取餐號獨立計數）
  storeId      String
  businessDate DateTime @db.Date
  lastSeq      Int      @default(0)
  updatedAt    DateTime @updatedAt
  @@id([storeId, businessDate])
}

// ---------- 統計（物化表） ----------
model DailyProductSales {
  storeId       String
  businessDate  DateTime @db.Date
  productId     String
  productNameZh String                 // 冗餘存放，商品改名後報表仍可讀
  quantitySold  Int      @default(0)   // 認列口徑見 §11
  grossAmount   Int      @default(0)
  refundedQty   Int      @default(0)
  refundedAmount Int     @default(0)
  netQuantity   Int      @default(0)   // = quantitySold - refundedQty
  netAmount     Int      @default(0)
  updatedAt     DateTime @updatedAt
  @@id([storeId, businessDate, productId])
  @@index([storeId, businessDate])
}

// ---------- 後台帳號 ----------
model AdminUser {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  displayName  String
  role         AdminRole @default(STAFF)
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  action     String              // "product.update" 等
  targetType String
  targetId   String
  diff       Json?
  ip         String?
  createdAt  DateTime @default(now())
  @@index([targetType, targetId, createdAt])
}
```

### 5.2 資料完整性規則（應用層強制，須有測試）

| ID | 規則 |
|---|---|
| INV-1 | 每個 `Product` 必須存在 4 筆 `ProductTranslation`（可為 fallback 內容），否則後台無法「上架」 |
| INV-2 | 每個 `Product` 至少 1 張 `ProductImage`，且恰有 1 張 `isPrimary = true` |
| INV-3 | `OptionGroup.selectType = SINGLE` 時 `maxSelect` 必為 1；`minSelect ∈ {0, 1}` |
| INV-4 | `OrderItem.lineTotal = (unitBasePrice + unitOptionsPrice) × quantity`，於建單交易內斷言 |
| INV-5 | `Order.totalAmount = Σ(items.lineTotal) − discountAmount`，於建單交易內斷言 |
| INV-6 | `Order.pickupNumber` 為非 null ⟺ `status ∈ {PAID, PREPARING, READY, COMPLETED, REFUNDED}` |
| INV-7 | 已被任何 `OrderItem` 引用的 `Product` 不得硬刪，只能設 `deletedAt` |
| INV-8 | `Payment.rawRequest/rawResponse` 寫入前須經 `maskSensitive()` 過濾卡號、CVV、Token |

---

## 6. 訂單狀態機與取貨單號

### 6.1 狀態機

```
                    ┌──────────────────┐
                    │ PENDING_PAYMENT  │ ◀── 建單
                    └───┬──────────┬───┘
        付款成功(webhook)│          │逾時 15 分 / 顧客放棄 / 店家取消
                        ▼          ▼
                    ┌───────┐  ┌───────────┐
   ★配發取貨單號 ──▶ │ PAID  │  │ CANCELLED │ (終態)
                    └───┬───┘  └───────────┘
             店員接單    │
                        ▼
                  ┌───────────┐
                  │ PREPARING │
                  └─────┬─────┘
             製作完成    │
                        ▼
                   ┌─────────┐
                   │  READY  │ ← 叫號中
                   └────┬────┘
             顧客取餐    │
                        ▼
                  ┌───────────┐
                  │ COMPLETED │ (終態)
                  └───────────┘

  REFUNDED：可從 PAID / PREPARING / READY / COMPLETED 進入（僅 ADMIN 角色，需填原因）
```

### 6.2 轉移表（`server/order/state-machine.ts` 須以此表驅動）

| From | To | 觸發者 | 前置條件 | 副作用 |
|---|---|---|---|---|
| PENDING_PAYMENT | PAID | PAYMENT_WEBHOOK | `payment.status = SUCCEEDED` 且金額相符 | 配發 `pickupNumber`、設 `paidAt` |
| PENDING_PAYMENT | CANCELLED | SYSTEM / STAFF | 逾時 job 或人工 | 設 `cancelledAt`、`cancelReason` |
| PAID | PREPARING | STAFF | — | — |
| PREPARING | READY | STAFF | — | 設 `readyAt`、觸發叫號顯示 |
| READY | COMPLETED | STAFF | — | 設 `completedAt`、更新 `DailyProductSales` |
| PAID / PREPARING / READY / COMPLETED | REFUNDED | ADMIN | 已成功付款 | 呼叫 `provider.refund()`、更新統計扣除 |

**其餘所有轉移一律拒絕**，回傳 `409 INVALID_STATE_TRANSITION`，並且不得寫入任何資料。

**併發控制**：狀態變更使用樂觀鎖 —
```sql
UPDATE "Order" SET status = $new, version = version + 1
WHERE id = $id AND version = $expectedVersion
-- affectedRows = 0 → 拋 ConflictError
```

### 6.3 取貨單號配發演算法（`server/order/pickup-number.ts`）

**時機**：僅在 `PENDING_PAYMENT → PAID` 的同一個 DB 交易內執行，確保「付款成功」與「有號碼」為原子操作。

```ts
// 在 prisma.$transaction 內執行
async function assignPickupNumber(tx, storeId: string, at: Date, store: Store) {
  const businessDate = toBusinessDate(at, store.timezone, store.businessDayCutoff);

  // 以 UPSERT + 原子遞增取號，避免併發重號
  const counter = await tx.$queryRaw`
    INSERT INTO "PickupCounter" ("storeId","businessDate","lastSeq","updatedAt")
    VALUES (${storeId}, ${businessDate}, 1, NOW())
    ON CONFLICT ("storeId","businessDate")
    DO UPDATE SET "lastSeq" = "PickupCounter"."lastSeq" + 1, "updatedAt" = NOW()
    RETURNING "lastSeq"
  `;

  const seq = counter[0].lastSeq;
  const cycle = Math.floor((seq - 1) / store.pickupMax);      // 超過上限自動換前綴
  const inCycle = ((seq - 1) % store.pickupMax) + 1;
  const prefix = String.fromCharCode(store.pickupPrefix.charCodeAt(0) + cycle); // A→B→C
  const pickupNumber = `${prefix}${String(inCycle).padStart(store.pickupPadding, '0')}`;

  return { pickupNumber, businessDate, pickupSeq: seq };
}
```

`toBusinessDate()` 規則：將 UTC 時間轉為門市時區後，若本地時間 < `businessDayCutoff`（預設 04:00），營業日視為前一天。

**必要測試**：
- 併發 200 筆同時付款 → 200 個相異號碼，序號連續無跳號（`tests/pickup-number.concurrency.test.ts`）
- 跨營業日 cutoff → 序號重置為 1
- 超過 `pickupMax` → 前綴進位 `A999 → B001`

### 6.4 訂單編號 `orderNo`

格式 `ORD-YYYYMMDD-NNNN`（`YYYYMMDD` 為**營業日** + 當日流水 4 碼）。建單時（`PENDING_PAYMENT`）即配發，與付款無關，因此與取貨單號的序號必然不同 —— 兩者使用各自的計數表（`OrderNoCounter` / `PickupCounter`），實作採與 §6.3 完全相同的原子 UPSERT 遞增邏輯，抽為共用函式 `nextSeq(tx, table, storeId, businessDate)`。

超過 9999 筆時流水碼自然擴展為 5 碼（不截斷、不回捲），因 `orderNo` 僅需唯一、不需人工唸讀。

---

## 7. 金流抽象層（廠商 API 保留位）

### 7.1 設計目標

廠商 API 文件尚未提供。本層的任務是**凍結上下游契約**，使日後只需新增 `providers/{vendor}.ts` 約 200–300 行 adapter，核心訂單流程零改動。

### 7.2 介面定義（`lib/payment/types.ts`）

```ts
export type ProviderCode = 'mock' | 'ecpay' | 'newebpay' | 'tappay';

export interface CreateChargeInput {
  orderId: string;
  orderNo: string;
  amount: number;              // 最小貨幣單位
  currency: 'TWD';
  locale: Locale;              // 廠商付款頁語系（能支援才傳）
  idempotencyKey: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  customer?: { name?: string; phone?: string; email?: string };
  returnUrl: string;           // 顧客付款後導回（前台訂單頁）
  notifyUrl: string;           // 伺服器對伺服器 webhook
  clientMeta?: { ip?: string; userAgent?: string };
}

/** 三種可能的付款啟動模式，涵蓋台灣主要金流的差異 */
export type CreateChargeResult =
  | { mode: 'REDIRECT'; paymentId: string; providerRef?: string; redirectUrl: string }
  | { mode: 'FORM_POST'; paymentId: string; providerRef?: string; action: string; fields: Record<string, string> }  // 綠界/藍新常見
  | { mode: 'SDK_TOKEN'; paymentId: string; providerRef?: string; clientToken: string; sdkParams: Record<string, unknown> }; // TapPay Fields

export interface RawWebhook {
  headers: Record<string, string>;
  rawBody: string;             // ★ 必須是未經 parse 的原始字串，供驗簽
  query: Record<string, string>;
}

export interface WebhookEvent {
  providerEventId: string;     // 用於冪等去重
  eventType: 'charge.succeeded' | 'charge.failed' | 'charge.cancelled' | 'refund.succeeded' | 'unknown';
  providerRef: string;
  orderNo: string;
  amount: number;
  currency: string;
  paidAt?: Date;
  method?: string;
  card?: { brand?: string; last4?: string };
  failure?: { code: string; message: string };
  raw: unknown;
}

export interface PaymentProvider {
  readonly code: ProviderCode;
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  verifySignature(raw: RawWebhook): boolean;
  parseWebhook(raw: RawWebhook): WebhookEvent;
  queryCharge(providerRef: string): Promise<{ status: PaymentStatus; amount: number; paidAt?: Date }>;
  refund(input: { providerRef: string; amount: number; reason?: string }): Promise<{ ok: boolean; refundRef?: string }>;
  /** 廠商回導頁的成功與否判定（部分廠商 returnUrl 帶簽章參數） */
  resolveReturn(query: Record<string, string>): { orderNo?: string; hint: 'SUCCESS' | 'FAILED' | 'UNKNOWN' };
}
```

### 7.3 Adapter 骨架（每個廠商檔案照此撰寫）

```ts
// lib/payment/providers/ecpay.ts
export class ECPayProvider implements PaymentProvider {
  readonly code = 'ecpay' as const;

  constructor(private cfg: {
    merchantId: string; hashKey: string; hashIv: string; endpoint: string;
  }) {}

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    // TODO(VENDOR-API): 依綠界《全方位金流》文件組裝參數並計算 CheckMacValue
    // 預期回傳 { mode: 'FORM_POST', action: this.cfg.endpoint, fields: {...} }
    throw new NotImplementedError('ECPay.createCharge — 待廠商 API 文件');
  }

  verifySignature(raw: RawWebhook): boolean {
    // TODO(VENDOR-API): 重算 CheckMacValue 與 raw.rawBody 中的值比對
    throw new NotImplementedError('ECPay.verifySignature — 待廠商 API 文件');
  }

  parseWebhook(raw: RawWebhook): WebhookEvent { throw new NotImplementedError(/* ... */); }
  async queryCharge(ref: string) { throw new NotImplementedError(/* ... */); }
  async refund(i: never) { throw new NotImplementedError(/* ... */); }
  resolveReturn(q: Record<string, string>) { throw new NotImplementedError(/* ... */); }
}
```

`NotImplementedError` 須為自訂 Error 子類，訊息統一為 `"{Provider}.{method} — 待廠商 API 文件"`，並被全域錯誤處理器轉為 `503 PAYMENT_PROVIDER_NOT_CONFIGURED`。

### 7.4 MockProvider（必須完整可用）

`providers/mock.ts` 需完整實作，讓整條流程在無廠商 API 的情況下可 E2E 測試：

- `createCharge` → 回傳 `{ mode: 'REDIRECT', redirectUrl: '/dev/mock-pay?orderNo=...&paymentId=...' }`
- `/dev/mock-pay` 為開發用頁面（`NODE_ENV !== 'production'` 才註冊路由），提供「模擬付款成功 / 失敗 / 逾時」三顆按鈕
- 按下後由伺服器自行 POST 至 `/api/v1/payments/webhook/mock`，走與真實 webhook **完全相同**的處理路徑
- `verifySignature` 以 `HMAC-SHA256(rawBody, MOCK_WEBHOOK_SECRET)` 實作，確保驗簽邏輯本身有被測試

### 7.5 付款流程（時序）

```
顧客        Next.js API            DB              金流廠商
 │ POST /orders  │                  │                  │
 │──────────────▶│ 重算金額、建單     │                  │
 │               │─────────────────▶│ PENDING_PAYMENT  │
 │ ◀─ orderNo + accessToken ────────│                  │
 │ POST /orders/{no}/payment        │                  │
 │──────────────▶│ createCharge()   │                  │
 │               │─────────────────────────────────────▶│
 │ ◀─ CreateChargeResult ───────────│                  │
 │ 依 mode 導向 / FormPost / SDK ───────────────────────▶│
 │                                  │        刷卡授權   │
 │               │ ◀── webhook (server-to-server) ──────│
 │               │ 驗簽 → 去重 → 金額比對                │
 │               │─────────────────▶│ PAID + 配號       │
 │ ◀─ returnUrl 導回訂單頁 ──────────│                  │
 │ 輪詢 GET /orders/{no} 直到取得 pickupNumber           │
```

**關鍵原則（不可違反）**：

1. **訂單狀態只認 webhook，不認 returnUrl。** 顧客瀏覽器可被竄改或中斷；`resolveReturn()` 的結果僅用於顯示提示文案。
2. **金額比對**：webhook 金額 ≠ `order.totalAmount` → 不轉狀態，寫入告警並標記 `payment.failureCode = 'AMOUNT_MISMATCH'`。
3. **Webhook 冪等**：先以 `PaymentEvent.@@unique([provider, providerEventId])` 插入；若違反唯一鍵，直接回 `200 OK` 並結束（重送安全）。
4. **Webhook 一律回 200**（除非驗簽失敗回 400），避免廠商無限重送。處理失敗改寫入 `PaymentEvent.processedAt = null` 由補償 job 處理。
5. **對帳補償 job**：每 5 分鐘掃描 `status = PENDING_PAYMENT` 且 `placedAt < now - 3min` 的訂單，呼叫 `queryCharge()` 主動查詢，解決 webhook 遺失。

### 7.6 廠商 API 到位前，須向廠商索取的清單

實作時同步產出 `docs/VENDOR-API-CHECKLIST.md`，內容至少涵蓋：

- [ ] 測試環境與正式環境 endpoint、商店代號、HashKey/HashIV（或 API Key/Secret）
- [ ] 建立交易的完整參數表與必填欄位
- [ ] 簽章演算法與待簽字串的組成規則（含 URL encode 大小寫細節）
- [ ] Webhook 的 HTTP method、Content-Type、欄位表、重送策略與次數
- [ ] 廠商交易唯一識別碼欄位名（用於 `providerRef` 與 `providerEventId`）
- [ ] 退款 API 規格（是否支援部分退款、退款時限）
- [ ] 查詢交易 API 規格（對帳補償用）
- [ ] 支援的付款頁語系清單（對應本系統 4 語系）
- [ ] 廠商 IP 白名單（webhook 來源）
- [ ] 是否代開電子發票；若否，需另接發票加值中心

---

## 8. API 契約

### 8.1 通則

- Base path：`/api/v1`
- 請求／回應一律 `application/json; charset=utf-8`（webhook 除外，依廠商）
- 所有輸入以 Zod 驗證，失敗回 `422`
- 錯誤格式統一：

```json
{ "error": { "code": "INVALID_STATE_TRANSITION", "message": "訂單狀態不允許此操作", "details": {} } }
```

- 錯誤碼列表（實作為 TS union type）：
  `VALIDATION_FAILED` `NOT_FOUND` `UNAUTHORIZED` `FORBIDDEN` `PRODUCT_UNAVAILABLE`
  `INVALID_OPTION_SELECTION` `AMOUNT_MISMATCH` `INVALID_STATE_TRANSITION`
  `ORDER_EXPIRED` `PAYMENT_PROVIDER_NOT_CONFIGURED` `CONFLICT` `RATE_LIMITED` `INTERNAL_ERROR`

- 語系傳遞：前台 API 以 query `?locale=ja` 指定；缺省取 `Accept-Language`；再缺省 `zh-TW`

### 8.2 前台 API

#### `GET /api/v1/menu?locale=ja`

回傳完整菜單（已依 locale 解析文字，前端不需再處理翻譯）。

```json
{
  "store": { "name": "…", "isOpen": true, "currency": "TWD" },
  "categories": [
    {
      "id": "cat_1", "slug": "drinks", "name": "ドリンク",
      "products": [
        {
          "id": "prd_1", "slug": "pearl-milk-tea",
          "name": "タピオカミルクティー",
          "description": "自家製タピオカ…",
          "basePrice": 65,
          "primaryImage": { "url": "https://…", "width": 800, "height": 800, "alt": "…" },
          "isSoldOut": false,
          "hasOptions": true
        }
      ]
    }
  ]
}
```

快取：`revalidate = 60`，並在後台變更商品時 `revalidateTag('menu')`。

#### `GET /api/v1/products/{slug}?locale=ja`

回傳單品詳情，含完整規格群組：

```json
{
  "id": "prd_1", "slug": "pearl-milk-tea", "name": "…", "description": "…",
  "basePrice": 65, "isSoldOut": false,
  "images": [{ "url": "…", "width": 800, "height": 800, "alt": "…" }],
  "optionGroups": [
    {
      "id": "og_size", "name": "サイズ", "selectType": "SINGLE",
      "minSelect": 1, "maxSelect": 1, "isRequired": true,
      "items": [
        { "id": "oi_m", "name": "M", "priceDelta": 0,  "isDefault": true },
        { "id": "oi_l", "name": "L", "priceDelta": 10, "isDefault": false }
      ]
    }
  ]
}
```

#### `POST /api/v1/orders`

Header：`Idempotency-Key: <uuid>`（必填）

```json
{
  "locale": "ja",
  "items": [
    { "productId": "prd_1", "quantity": 2, "optionItemIds": ["oi_l", "oi_pearl"] }
  ],
  "customer": { "name": "山田", "phone": "0912345678" },
  "note": "少冰"
}
```

**伺服器端處理（順序不可調換）**：

1. 驗證 store `isOpen`
2. 逐項驗證 product 存在、`isActive = true`、`deletedAt = null`、`isSoldOut = false` → 否則 `PRODUCT_UNAVAILABLE`
3. 驗證選項合法性：所選 `optionItemId` 必須屬於該商品綁定的群組；每個群組的選取數量須符合 `minSelect/maxSelect`；必填群組不得為空 → 否則 `INVALID_OPTION_SELECTION`
4. **完全依 DB 重算金額**（請求中若出現任何 price 欄位，一律忽略）
5. 於單一交易內：建 Order（`PENDING_PAYMENT`）、OrderItem、OrderItemOption（寫入四語系快照）、配發 `orderNo`、產生 `accessToken`、設 `expiresAt = now + 15min`

回應 `201`：

```json
{
  "orderNo": "ORD-20260815-0007",
  "accessToken": "a1b2…",
  "totalAmount": 150,
  "currency": "TWD",
  "expiresAt": "2026-08-15T06:15:00Z",
  "items": [{ "name": "タピオカミルクティー", "quantity": 2, "unitPrice": 75, "lineTotal": 150 }]
}
```

同一 `Idempotency-Key` 重送 → 回傳原訂單，`200`。

#### `POST /api/v1/orders/{orderNo}/payment`

Header：`X-Order-Token: <accessToken>`

```json
{ "provider": "ecpay", "returnPath": "/ja/order/ORD-20260815-0007" }
```

前置檢查：訂單存在、token 相符、`status = PENDING_PAYMENT`、`now < expiresAt`（逾時回 `ORDER_EXPIRED`）。

回應直接透傳 `CreateChargeResult`（三種 mode 之一），前端依 `mode` 分支處理。
廠商未實作時回 `503 PAYMENT_PROVIDER_NOT_CONFIGURED`。

#### `GET /api/v1/orders/{orderNo}`

Header：`X-Order-Token: <accessToken>`

```json
{
  "orderNo": "ORD-20260815-0007",
  "status": "READY",
  "pickupNumber": "A013",
  "totalAmount": 150,
  "placedAt": "…", "paidAt": "…", "readyAt": "…",
  "items": [{ "name": "…", "quantity": 2, "unitPrice": 75, "options": ["L", "タピオカ"] }]
}
```

前台訂單頁在 `status ∈ {PENDING_PAYMENT, PAID, PREPARING}` 時以 5 秒間隔輪詢此端點。

#### `POST /api/v1/payments/webhook/{provider}`

無認證（以簽章驗證）。處理流程：

```
1. 讀取原始 body（不可先 JSON.parse）
2. provider.verifySignature(raw) → false 則記錄後回 400
3. provider.parseWebhook(raw) → WebhookEvent
4. INSERT PaymentEvent (provider, providerEventId) → 唯一鍵衝突則回 200（已處理）
5. 查 Order by orderNo；金額比對；不符 → 記錄 AMOUNT_MISMATCH，回 200 不轉狀態
6. 交易內：更新 Payment、Order 狀態機轉移 → PAID、配發 pickupNumber、寫 OrderEvent
7. 標記 PaymentEvent.processedAt，回 200
```

### 8.3 後台 API（皆需 session；`/admin/*` 由 middleware 保護）

| Method | Path | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/v1/admin/products` | STAFF | 分頁、關鍵字、分類、上架狀態篩選 |
| POST | `/api/v1/admin/products` | ADMIN | 建立（須含 4 語系翻譯） |
| GET | `/api/v1/admin/products/{id}` | STAFF | 含所有語系與規格綁定 |
| PATCH | `/api/v1/admin/products/{id}` | ADMIN | 部分更新 |
| DELETE | `/api/v1/admin/products/{id}` | ADMIN | 軟刪除 |
| PATCH | `/api/v1/admin/products/{id}/availability` | STAFF | 切換 `isActive` / `isSoldOut` |
| POST | `/api/v1/admin/uploads/presign` | ADMIN | 回傳 S3 presigned PUT URL；限 jpeg/png/webp、≤ 5MB |
| GET/POST/PATCH/DELETE | `/api/v1/admin/categories[/{id}]` | ADMIN | 分類 CRUD |
| GET/POST/PATCH/DELETE | `/api/v1/admin/option-groups[/{id}]` | ADMIN | 規格群組 CRUD |
| GET | `/api/v1/admin/orders` | STAFF | 篩選 status / 日期 / 取貨號 |
| PATCH | `/api/v1/admin/orders/{id}/status` | STAFF | body: `{ toStatus, expectedVersion, note? }`，走 §6.2 |
| POST | `/api/v1/admin/orders/{id}/refund` | ADMIN | body: `{ reason }` |
| GET | `/api/v1/admin/stats/daily-product-sales` | ADMIN | query: `from`, `to`, `productId?`, `format=json\|csv` |
| GET | `/api/v1/admin/stats/summary` | ADMIN | 當日營收、單量、平均客單價、熱銷 Top 10 |
| GET | `/api/v1/admin/translations/missing` | ADMIN | 列出缺譯的商品／規格 |

---

## 9. 前台頁面規格

### 9.1 共通

- **行動優先**：主要使用情境為手機掃 QR，斷點 `sm` 為預設設計基準
- Header：店名、語系切換（下拉，顯示 `繁中 / English / 日本語 / 한국어`）、購物車圖示與品項數 badge
- 購物車狀態存於 `localStorage`（key: `cart.v1`），含 `{ productId, quantity, optionItemIds[] }`；**不存價格**，價格一律進頁面時重新向 API 取得
- 語系切換時保留當前路徑與購物車內容

### 9.2 菜單頁 `/{locale}`

- 分類作為 sticky 分頁籤，點擊平滑捲動至該區塊
- 商品卡片：主圖（1:1，`next/image`，lazy）、名稱、簡介（2 行截斷）、價格、快速加入按鈕
- 無規格商品 → 卡片上直接「＋」加入；有規格商品 → 導向詳情頁
- `isSoldOut = true` → 卡片灰階 + 「已售完」遮罩，不可點擊
- 空狀態、載入骨架屏皆須實作

### 9.3 商品詳情頁 `/{locale}/product/{slug}`

- 圖片輪播（多圖時）
- 規格群組：SINGLE 用 radio chip、MULTIPLE 用 checkbox；顯示 `+NT$10` 加價提示
- 必填群組未選 → 「加入購物車」按鈕 disabled 並顯示提示
- 數量 stepper（1–99）
- 底部 sticky bar：即時試算金額 = `(basePrice + Σ選項) × 數量`

### 9.4 購物車 `/{locale}/cart`

- 逐項顯示名稱、已選規格、單價、數量調整、刪除
- 進入頁面時呼叫 `GET /api/v1/menu` 校驗每一項是否仍可購買；已下架／售完者標紅並要求移除後才可結帳
- 小計與總計（v1 兩者相同）

### 9.5 結帳頁 `/{locale}/checkout`

- 表單：姓名（選填）、手機（選填，格式驗證）、備註（選填，≤ 200 字）
- 付款方式：v1 僅「信用卡」，UI 已預留列表結構
- 送出 → `POST /orders` → `POST /orders/{no}/payment` → 依 `mode` 分支：
  - `REDIRECT` → `window.location.assign(redirectUrl)`
  - `FORM_POST` → 動態建立隱藏 form 自動 submit
  - `SDK_TOKEN` → 載入廠商 SDK，掛載 Fields（`TODO(VENDOR-API)` 標記處）
- 送出按鈕須有 loading 與防重複點擊；`Idempotency-Key` 於進入結帳頁時產生並暫存

### 9.6 訂單狀態頁 `/{locale}/order/{orderNo}`

**這是整個系統對顧客最重要的畫面。**

- `accessToken` 存於 `sessionStorage`；亦支援 `?t={token}` 進入（供分享／重開）
- `PENDING_PAYMENT`：顯示「等待付款」+ 倒數計時至 `expiresAt` + 「重新付款」按鈕
- `PAID` 之後：**取餐號碼以超大字體（≥ 96px）置中顯示**，純英數不翻譯
- 狀態進度條：已付款 → 製作中 → 可取餐 → 已完成
- `READY`：全畫面高對比提示 + 可選的震動 `navigator.vibrate`
- 頁面提供「加入書籤／截圖保存」提示，並顯示訂單明細與金額
- 輪詢：`PENDING_PAYMENT/PAID/PREPARING` 每 5 秒；`READY` 每 15 秒；終態停止

---

## 10. 後台頁面規格

固定 zh-TW，桌機優先，但訂單看板須在平板可用。

### 10.1 登入 `/admin/login`

Email + 密碼；失敗 5 次鎖定 15 分鐘（以 IP + email 計數）。

### 10.2 訂單看板 `/admin/orders`

- 四欄看板：**待製作(PAID) / 製作中(PREPARING) / 可取餐(READY) / 已完成(COMPLETED)**
- 卡片顯示：**取餐號（最大）**、下單時間、等待分鐘數、品項摘要、備註（有備註時高亮）
- 一鍵推進狀態按鈕；操作時帶 `expectedVersion`，衝突時提示「訂單已被他人更新」並重新載入
- 自動更新：每 10 秒輪詢（v1 用輪詢，不引入 WebSocket）
- 新單抵達時播放提示音（可開關，設定存 localStorage）
- 篩選：日期（預設今日營業日）、狀態、取餐號搜尋

### 10.3 商品管理 `/admin/products`

- 列表：主圖縮圖、zh-TW 名稱、分類、價格、上架狀態、售完開關、**翻譯完整度標記**（`4/4` 或 `⚠ 2/4`）
- 拖曳排序（更新 `sortOrder`）
- 編輯頁採分頁籤：
  - **基本**：分類、slug、SKU、basePrice、上架狀態
  - **語系**：四個子頁籤 zh-TW / EN / JA / KO，各含名稱 + 簡介；提供「複製 zh-TW 內容到此語系」按鈕作為暫用
  - **圖片**：拖放上傳（走 presign），設定主圖、排序
  - **規格**：勾選要綁定的 OptionGroup、設定順序與是否必填
- 儲存前端 Zod 驗證 + 後端二次驗證；**未滿足 INV-1/INV-2 不得設為上架**

### 10.4 規格管理 `/admin/option-groups`

群組 CRUD（code、selectType、min/max）與選項 CRUD（code、priceDelta、預設值、四語系名稱）。

### 10.5 銷售統計 `/admin/stats`

- 日期區間選擇（快捷：今日 / 昨日 / 近 7 日 / 本月）
- **KPI 卡**：總營收、訂單數、平均客單價、退款金額
- **每日各商品銷售量表**（核心需求 R3）：
  | 商品 | 銷售數量 | 銷售金額 | 退款數量 | 淨數量 | 淨金額 | 佔比 |
  預設依淨數量降冪；支援排序與 CSV 匯出（UTF-8 BOM，Excel 可直開）
- **趨勢圖**：區間內每日訂單數與營收（雙軸折線）
- **熱銷 Top 10** 長條圖
- 全站統計一律以 §11 的口徑計算，頁面上須明文標示口徑說明

---

## 11. 銷售統計口徑（必須嚴格遵守）

模糊的統計口徑是這類系統最常見的錯誤來源，以下定義為唯一標準：

| 項目 | 定義 |
|---|---|
| **歸屬日期** | 以 `order.paidAt` 換算的**營業日**（`businessDate`），非 `placedAt`、非日曆日 |
| **計入 `quantitySold`** | 訂單狀態 ∈ {`PAID`, `PREPARING`, `READY`, `COMPLETED`} 的所有 `OrderItem.quantity` |
| **不計入** | `PENDING_PAYMENT`（未付款）、`CANCELLED` |
| **`refundedQty`** | 狀態轉為 `REFUNDED` 的訂單，其品項數量計入退款欄位；**歸屬於原始 `paidAt` 的營業日**，非退款當日 |
| **`netQuantity`** | `quantitySold − refundedQty` ← **報表預設顯示此欄** |
| **`grossAmount`** | Σ `OrderItem.lineTotal`（含選項加價） |
| **商品識別** | 以 `productId` 聚合；商品改名後報表沿用 `productNameZh` 快照，但同一 productId 視為同一商品 |

**更新機制**：於下列時機在同一交易內 upsert `DailyProductSales` —
- `→ PAID`：累加 `quantitySold` / `grossAmount`
- `→ REFUNDED`：累加 `refundedQty` / `refundedAmount`
- 兩者皆同步重算 `netQuantity` / `netAmount`

**一致性檢查**：另提供 CLI `npm run stats:rebuild -- --from=2026-08-01 --to=2026-08-15`，由 Order 明細全量重算並比對差異，作為對帳與修復手段。此指令須有測試。

---

## 12. 非功能性需求

### 12.1 安全

| 項目 | 要求 |
|---|---|
| 卡號 | **系統絕不接觸、不儲存、不記錄完整卡號與 CVV**。一律由廠商 SDK/付款頁承接。此為 PCI-DSS SAQ-A 範圍前提，不得妥協 |
| 傳輸 | 全站 HTTPS；HSTS |
| Webhook | 驗簽 + IP 白名單（`PAYMENT_WEBHOOK_ALLOWED_IPS` 環境變數，逗號分隔；空值代表不限制，正式環境須設定） |
| 訂單存取 | `accessToken` ≥ 32 bytes 隨機；不得以連號 orderNo 直接查單 |
| 後台 | Auth.js session（httpOnly, secure, sameSite=lax）；密碼 bcrypt cost ≥ 12；所有寫入操作記 `AuditLog` |
| 速率限制 | `POST /orders` 每 IP 10 次/分；`/admin/login` 每 IP 5 次/分；webhook 不限 |
| 上傳 | 驗證 magic bytes 而非僅副檔名；圖片重新編碼為 webp 去除 EXIF |
| 標頭 | CSP、X-Content-Type-Options、Referrer-Policy 於 middleware 統一設定 |
| 日誌 | 結構化 JSON；`maskSensitive()` 過濾卡號、token、accessToken、phone（僅留後 3 碼） |

### 12.2 效能

- 菜單頁 LCP < 2.5s（4G 行動網路，含圖片）
- API p95 < 300ms（不含金流廠商往返）
- 商品圖片以 `next/image` 產生多尺寸；原圖上傳後轉 webp，最大邊 1200px

### 12.3 可觀測性

- 結構化日誌含 `requestId`（middleware 產生並貫穿）
- 需告警的事件：webhook 驗簽失敗、`AMOUNT_MISMATCH`、狀態機非法轉移、`PENDING_PAYMENT` 逾時率 > 20%、`NotImplementedError` 被觸發
- `/api/health` 回傳 DB 連線與 migration 版本

### 12.4 環境變數（`.env.example` 須完整列出）

```
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
APP_BASE_URL=

STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_PUBLIC_BASE_URL=

PAYMENT_PROVIDER=mock              # mock | ecpay | newebpay | tappay
PAYMENT_WEBHOOK_ALLOWED_IPS=
MOCK_WEBHOOK_SECRET=

# TODO(VENDOR-API)：以下待廠商提供後填入
ECPAY_MERCHANT_ID=
ECPAY_HASH_KEY=
ECPAY_HASH_IV=
ECPAY_ENDPOINT=
NEWEBPAY_MERCHANT_ID=
NEWEBPAY_HASH_KEY=
NEWEBPAY_HASH_IV=
TAPPAY_PARTNER_KEY=
TAPPAY_MERCHANT_ID=
TAPPAY_APP_ID=
TAPPAY_APP_KEY=

ORDER_EXPIRE_MINUTES=15            # 未付款訂單逾時分鐘數（全域）
BUSINESS_DAY_CUTOFF=04:00          # ⚠ 僅作為 seed 時 Store.businessDayCutoff 的初始值
```

**單一真實來源原則**：`businessDayCutoff`、`timezone`、`currency`、取貨號設定的執行期唯一來源是 **`Store` 資料表**，環境變數僅供 seed 使用。程式碼中一律讀 `store.*`，**不得**在執行期讀 `process.env.BUSINESS_DAY_CUTOFF`。

### 12.5 測試要求

| 層級 | 範圍 | 門檻 |
|---|---|---|
| 單元 | `lib/money.ts`、`state-machine.ts`、`pickup-number.ts`、選項驗證、`toBusinessDate` | 100% 分支覆蓋 |
| 整合 | 建單交易、webhook 冪等、樂觀鎖衝突、統計 upsert | 全部關鍵路徑 |
| 併發 | 200 併發配號無重複；同 `Idempotency-Key` 併發建單只產生 1 筆 | 必測 |
| E2E (Playwright) | 四語系各跑一次：瀏覽 → 選規格 → 加入購物車 → 結帳 → MockProvider 付款 → 取得取貨號 → 後台推進至完成 → 統計數字正確 | 必測 |

---

## 13. 里程碑與驗收條件

| # | 里程碑 | 交付內容 | 驗收條件（Definition of Done） |
|---|---|---|---|
| M0 | 專案骨架 | Next.js 初始化、Tailwind、ESLint、Prisma、Docker Compose（Postgres + MinIO） | `npm run dev` 可啟動；`npm run typecheck` `npm run lint` 全綠 |
| M1 | 資料層 + i18n | 完整 schema、migration、seed（≥ 8 商品 × 4 語系 + 2 規格群組）、四語系路由與 messages 骨架 | 切換 `/zh-TW` `/en` `/ja` `/ko` 皆正常；seed 後 DB 資料完整 |
| M2 | 前台瀏覽與購物車 | 菜單頁、詳情頁、購物車、語系切換 | 四語系皆能瀏覽並正確顯示商品內容；購物車跨頁保存；金額試算正確 |
| M3 | 訂單 + 後台管理 | 建單 API、狀態機、取貨號配發、後台登入／商品 CRUD／訂單看板 | 併發配號測試通過；狀態機非法轉移被拒；後台可完整維護四語系商品 |
| M4 | 金流骨架 | `PaymentProvider` 介面、MockProvider 全鏈路、三家 adapter 骨架、webhook 端點、逾時 job、對帳 job | Mock 可完成「下單→付款→配號」E2E；webhook 重送不重複處理；金額不符不轉狀態；真實 provider 呼叫回 503 |
| M5 | 統計報表 | `DailyProductSales` upsert、統計頁、CSV 匯出、`stats:rebuild` CLI | 造 20 筆含退款的訂單，報表數字與手算一致；rebuild 結果與即時累加一致 |
| M6 | 收斂 | 效能調校、安全標頭、E2E 全綠、`.env.example`、README、`VENDOR-API-CHECKLIST.md` | 所有測試通過；Lighthouse 行動版 Performance ≥ 85；文件齊備 |

**M4 交付時必須明確回報**：哪些方法為 `TODO(VENDOR-API)`、各需要廠商文件的哪一節，並更新 `docs/VENDOR-API-CHECKLIST.md`。

---

## 14. 已識別的需求缺口與預設決策

以下為原始需求未涵蓋、但不決定就無法實作的事項。**本文件已採用預設值，若與實際營運不符，請於動工前修正。**

### 14.1 取貨單號的配發時機（原需求語意含糊）

「線上下單後可線上刷卡並產生取貨單號」未明確號碼在何時產生。
**已決策**：付款成功（webhook）時才配號。理由：建單即配號會讓未完成付款的訂單佔用號碼，造成叫號斷號、店員混淆。
**影響**：顧客在 `PENDING_PAYMENT` 階段看不到號碼，訂單頁需明確呈現「付款完成後將顯示取餐號碼」。

### 14.2 號碼上限與回捲

單日訂單若超過 999 筆，`A999` 之後如何處理原需求未定義。
**已決策**：自動進位為 `B001`，上限與前綴皆可於 `Store` 設定調整。

### 14.3 營業日 vs 日曆日

若店家跨午夜營業（例如營業至 02:00），以日曆日計算會使凌晨訂單被歸到隔天、號碼中途重置。
**已決策**：導入 `businessDayCutoff`（預設 04:00），統計與配號皆以營業日為準。此設定同時影響 §11 統計口徑。

### 14.4 商品規格的翻譯（最容易漏掉的地方）

需求只提到「產品名稱、簡介」需多語系，但既然商品有規格選項，**「尺寸／大杯／珍珠」等文字同樣會出現在顧客畫面與訂單明細**。
**已決策**：`OptionGroup` 與 `OptionItem` 皆建立翻譯子表，且 `OrderItemOption` 儲存四語系快照。若略過此點，日文顧客會在日文介面看到中文選項，體驗破碎。

### 14.5 統計的退款與取消處理

「統計每日各產品銷售量」未定義退款、取消是否計入，也未定義退款歸屬日期。
**已決策**：見 §11。取消不計入；退款歸屬**原始付款日**而非退款日（否則會出現某日淨銷量為負的怪異報表）。

### 14.6 電子發票（台灣營運的實務必要項）

需求未提及，但在台灣接受信用卡付款、開立統一發票為法定義務。
**已決策**：v1 不實作，但於 `Order` 保留擴充空間，並在 `docs/VENDOR-API-CHECKLIST.md` 中列為必問項目（多數金流廠商提供代開服務）。**上線前必須確認此事。**

### 14.7 庫存

需求未提及庫存管理。
**已決策**：v1 僅提供 `isSoldOut` 手動開關（每日 cutoff 自動重置為 false）。真實庫存扣減涉及超賣控制與併發鎖，複雜度高，列為 v2。

### 14.8 顧客通知

「可取餐」時如何通知顧客，需求未定義。
**已決策**：v1 僅靠訂單頁輪詢 + 店內叫號。SMS／LINE 推播列為 v2（會產生額外成本與第三方串接）。

### 14.9 語系與金額的關係

四語系可能暗示海外顧客，但刷卡幣別為 TWD。
**已決策**：一律以 TWD 計價與顯示，不做匯率換算。顯示換算價但實際扣款不同金額，容易引發爭議。

---

## 附錄 A：詞彙對照（避免命名漂移）

| 中文 | 程式碼命名 | 說明 |
|---|---|---|
| 取貨單號／取餐號 | `pickupNumber` | 對顧客顯示的叫號號碼，如 `A013` |
| 訂單編號 | `orderNo` | 對外訂單識別，`ORD-YYYYMMDD-NNNN` |
| 規格群組 | `OptionGroup` | 如「尺寸」 |
| 規格選項 | `OptionItem` | 如「大杯 +10」 |
| 營業日 | `businessDate` | 經 cutoff 換算後的歸屬日期 |
| 上架／下架 | `isActive` | 長期性 |
| 售完 | `isSoldOut` | 當日性，每日重置 |
| 金額最小單位 | minor unit | TWD 的 minor unit 即「元」 |

## 附錄 B：不得做的事（明確禁令）

1. 不得信任前端傳來的任何價格、金額欄位
2. 不得以 `returnUrl` 的參數作為訂單付款成功的依據
3. 不得儲存或記錄完整卡號、CVV、3D 驗證資料
4. 不得使用 float / double 儲存或計算金額
5. 不得在 `PENDING_PAYMENT` 狀態配發取貨單號
6. 不得繞過 §6.2 狀態轉移表直接 `UPDATE status`
7. 不得因廠商 API 未定而簡化或跳過金流流程；一律以 `NotImplementedError` 佔位
8. 不得在後台以外的地方硬刪商品資料
9. 不得將任何面向顧客的文字硬編碼於元件中（一律走 `messages/` 或 DB 翻譯表）
