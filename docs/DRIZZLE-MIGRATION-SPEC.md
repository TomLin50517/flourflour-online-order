# Prisma → Drizzle ORM 遷移規劃書

> 版本 v1.0 ｜ 2026-08-17 ｜ 交付對象：Claude Code
> 本文件是 `SPEC.md` 的**補充契約**，定義「把 ORM 從 Prisma 換成 Drizzle」這件事要怎麼做。
> 與 `SPEC.md` 本身衝突時，以本文件為準（本文件範圍內：ORM／資料存取層／部署）；
> 業務規則（狀態機、金額計算、金流流程等）一律仍以 `SPEC.md` 為準，本次遷移**不改變任何業務邏輯**。

---

## 0. 為什麼要換

見 `docs/OPEN-QUESTIONS.md`「正式站 500：Prisma 7 的 wasm query compiler 在 workerd 上完全無法執行期載入」條目。結論摘要：

- Prisma 7 的查詢引擎（driver adapter 架構下）是一個 **wasm 模組**，執行期需要 `WebAssembly.compileStreaming` / `WebAssembly.compile` / `new WebAssembly.Module()` 三者之一才能取得可用的 `WebAssembly.Module`。
- Cloudflare Workers（workerd）基於安全考量，**三者都不提供**，唯一合法路徑是「部署時就編譯好的靜態 import」。
- 試過五種修法（generator `runtime="workerd"`、legacy `wasm_modules` binding、`serverExternalPackages` 兩種變體、`next build --webpack`），全部因為 Next.js 16.3.1 的 Turbopack／webpack 都會把這個靜態 import 又轉譯回某種執行期載入邏輯而失敗，且兩個 bundler 失敗的根本原因彼此不同。
- 這是 **Next.js 16（Turbopack/webpack）+ Prisma 7（wasm query compiler）+ `@opennextjs/cloudflare`（目前最新 1.20.2）三者組合的真實上游相容性缺口**，不是本專案程式碼能繞開的問題，也沒有已知時間表會修好。

**Drizzle ORM 是純 JS/TS 產生 SQL，沒有任何編譯引擎（不需要 wasm、不需要 Rust binary）**，是 Cloudflare 官方文件與生態系中 Workers + Postgres/Hyperdrive 的標準搭配，從根本上不存在這個問題類別。

---

## 1. 範圍與不變項

### 1.1 這次遷移「要做」的事

- 把 `prisma/schema.prisma` 轉譯為 Drizzle schema（TypeScript）。
- 把所有 `server/**` 內的 Prisma Client 呼叫改寫為 Drizzle 等價寫法。
- 把 `src/lib/db.ts` 的連線建立方式從 `@prisma/adapter-pg` 改為 Drizzle 對應的 driver。
- 把 migration 工具鏈從 `prisma migrate` 換成 `drizzle-kit`。
- 把 8 個直接操作 DB 的 Vitest 整合測試、`prisma/seed.ts`、`scripts/*.ts` 全部改寫。
- 把 `wrangler.jsonc`／`next.config.ts`／`package.json` 裡所有為了讓 Prisma wasm 能跑而加的暫時性設定全部移除（`generator` 的 `runtime`/`compilerBuild`、`serverExternalPackages` 等）。

### 1.2 這次遷移「不做」的事（明確排除，避免範圍蔓延）

- **不改變任何資料表結構、欄位語意、索引策略**（CLAUDE.md 的「欄位語意不得變更」原則延伸適用於這次遷移）。
- **不改變任何 API 契約**（`SPEC.md` §8 完全不動，前端／外部呼叫方無感知）。
- **不改變任何業務邏輯**（狀態機轉移規則、取貨單號演算法、金額計算、統計口徑，逐條照搬）。
- **不順便重構其他不相關的程式碼**（例如 CLAUDE.md 反覆提醒的陷阱清單、既有的 route group 重構——除非遷移過程中發現這些程式碼本身就是為了配合 Prisma 而存在，見 §7）。
- **不解決 `@cf-wasm/photon` 的圖片處理 wasm 問題**（見 `docs/OPEN-QUESTIONS.md`，那是 `/api/v1/admin/uploads` 這條路由的獨立問題，跟 ORM 無關，另案處理）。

---

## 2. 新技術棧

```diff
- ORM          Prisma 7.x（driver adapter + wasm query compiler）
+ ORM          Drizzle ORM 0.x + drizzle-kit（純 JS/TS，無編譯引擎）
  DB Driver     pg（node-postgres）—— 不變，Drizzle 直接用同一個 pg.Pool
  Cloudflare    drizzle-orm/node-postgres + Hyperdrive（不再需要任何 wasm generator 設定）
```

新增套件：`drizzle-orm`、`drizzle-kit`（devDependency）、`@paralleldrive/cuid2`（Prisma 的 `cuid()` 預設值是應用層產生，Drizzle 沒有內建等價物，需要顯式套件）。

移除套件：`@prisma/client`、`@prisma/adapter-pg`、`prisma`（CLI）。

---

## 3. Schema 對照表

以下逐一 model 列出 Prisma → Drizzle 的對應與**需要特別注意的差異**（純機械對應的欄位不重複列出，只列有陷阱的部分）。

### 3.1 通用轉換規則

| Prisma | Drizzle | 備註 |
|---|---|---|
| `String @id @default(cuid())` | `text('id').primaryKey().$defaultFn(() => createId())` | `createId` 來自 `@paralleldrive/cuid2`；**cuid() 是應用層產生，不是 DB default**，Drizzle 用 `$defaultFn` 在 insert 當下算好塞進去 |
| `DateTime @default(now())` | `timestamp('created_at').defaultNow()` | DB 層級 default，可留在資料庫 |
| `DateTime @updatedAt` | `timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date())` | Drizzle 有對應 API，行為與 Prisma 一致（每次 `.update()` 呼叫時自動填入） |
| `Int` | `integer(...)` | 直接對應，金額欄位維持 Int，不做浮點轉換（CLAUDE.md 硬性規則不變） |
| `String?` | `text(...)`（不加 `.notNull()`） | Drizzle 預設欄位可為 null，跟 Prisma 相反（Prisma 預設 non-null，`?` 才是 nullable）——**遷移時每個欄位都要反過來明確標記**，這是最容易出錯的地方，見 §8 檢查清單 |
| `Json` | `jsonb(...).$type<T>()` | 用 `.$type<T>()` 標注 TS 型別，行為類似 Prisma 的 `Json` + 應用層 cast。**改用 `jsonb` 而非 `json`**（Postgres 建議；Prisma 的 `Json` 底層預設也是 `jsonb`） |
| `enum X { A B }` | `pgEnum('x', ['A', 'B'])` | Drizzle enum 值需與 DB 既有 enum 完全一致（見 §6 migration 策略，既有 enum 值不變） |
| `@@unique([a, b])` | `unique('name').on(t.a, t.b)` | 表定義第三參數的 callback 內 |
| `@@id([a, b])` | `primaryKey({ columns: [t.a, t.b] })` | 複合主鍵 |
| `@@index([a, b])` | `index('name').on(t.a, t.b)` | 索引名稱需自己命名，不像 Prisma 自動產生 |
| `onDelete: Cascade` | `.references(() => x.id, { onDelete: 'cascade' })` | 直接對應 |
| `@db.Text` | `text(...)` | Drizzle `text()` 本身即無長度限制，等價 |
| `@db.Date` | `date(...)` | 直接對應 |

### 3.2 逐 model 備註

| Model | 特別注意 |
|---|---|
| `Store` | 無特殊點，純設定表 |
| `Category` / `CategoryTranslation` | 無特殊點 |
| `Product` / `ProductTranslation` / `ProductImage` | `deletedAt DateTime?` 軟刪除欄位，**所有查詢的 `where` 都要記得加 `isNull(deletedAt)`**——Prisma 的查詢寫法裡這個條件本來就要手動加（不是自動過濾），行為不變，只是換個語法 |
| `OptionGroup` / `OptionGroupTranslation` / `OptionItem` / `OptionItemTranslation` | 無特殊點 |
| `ProductOptionGroup` | 複合主鍵 `@@id([productId, groupId])`，Drizzle 用 `primaryKey({ columns: [...] })` |
| **`Order`** | `version Int @default(0)` 樂觀鎖欄位——**這是遷移風險最高的欄位**，見 §5.2「狀態機」。`nameSnapshot`/`imageUrlSnapshot` 等快照欄位型別不變 |
| `OrderItem` / `OrderItemOption` | `nameSnapshot`/`groupNameSnapshot`/`itemNameSnapshot` 都是 `jsonb`，型別標注 `Record<LocaleCode, string>` |
| `OrderEvent` | `fromStatus OrderStatus?`（nullable enum，首次轉移時為 null）——Drizzle enum 欄位一樣可設 nullable |
| `Payment` / `PaymentEvent` | `rawRequest`/`rawResponse`/`payload` 為 `jsonb`；`PaymentEvent` 的 `@@unique([provider, providerEventId])` 是 webhook 冪等的關鍵，複合唯一約束照搬 |
| `PickupCounter` / `OrderNoCounter` | 複合主鍵 `@@id([storeId, businessDate])`；這兩張表**只透過原始 SQL UPSERT 操作**（見 §5.3），Drizzle schema 定義本身很單純，複雜度在查詢端不在 schema 端 |
| `DailyProductSales` | 複合主鍵 `@@id([storeId, businessDate, productId])`；見 §5.4 的 upsert+increment 寫法 |
| `AdminUser` / `AuditLog` | 無特殊點 |

---

## 4. 查詢模式對照表（這是本次遷移的核心工程量）

Drizzle 跟 Prisma 最大的架構差異：**Prisma 有「巢狀寫入」（nested writes，`create: { nested: {...} }` 一次呼叫級聯寫多張表）跟「巢狀讀取」（`include`，一次呼叫回傳關聯物件樹），Drizzle 讀取有等價功能（Relational Queries API），但寫入完全沒有**，必須手動在同一個 transaction 內依序對每張表各自 insert。

### 4.1 巢狀讀取（`include` → Relational Queries API）

Drizzle 提供 `db.query.tableName.findMany({ with: {...} })`，語法與 Prisma 的 `include` 高度相似，**這部分改寫成本低、風險低**。前提：schema 檔案除了 table 定義外，還要用 `relations()` helper 明確宣告每個關聯（Prisma 靠 `@relation` 自動推導，Drizzle 要手動寫一次，一次性成本）。

範例（`getMenu`）：

```ts
// Prisma
prisma.category.findMany({
  where: { storeId, isActive: true },
  orderBy: { sortOrder: "asc" },
  include: { translations: true, products: { where: {...}, include: {...} } },
});

// Drizzle
db.query.category.findMany({
  where: (c, { eq, and }) => and(eq(c.storeId, storeId), eq(c.isActive, true)),
  orderBy: (c, { asc }) => asc(c.sortOrder),
  with: {
    translations: true,
    products: { where: (p, { and, eq, isNull }) => and(...), with: {...} },
  },
});
```

受影響檔案：`get-menu.ts`、`get-product.ts`、`get-order.ts`、`admin-products.ts`（`getProductAdmin`/`listProductsAdmin`）、`admin-option-groups.ts`（`listOptionGroupsAdmin`）、`admin-categories.ts`、`reconcile.ts`（`include: { payments: {...} }`）。

### 4.2 巢狀寫入（`create: { nested }` → 手動依序 insert）

**沒有捷徑，逐一改寫。** 通用模式：

```ts
// Prisma（一次呼叫）
await prisma.order.create({
  data: { ...orderFields, items: { create: preparedItems.map(item => ({
    ...itemFields, options: { create: item.options } })) } },
  include: { items: { include: { options: true } } },
});

// Drizzle（transaction 內依序 insert，手動組回巢狀形狀）
await db.transaction(async (tx) => {
  const [order] = await tx.insert(orderTable).values({ ...orderFields }).returning();
  const insertedItems = await tx.insert(orderItemTable)
    .values(preparedItems.map(item => ({ ...itemFields, orderId: order.id })))
    .returning();
  // options 需要知道對應的 orderItemId，若 preparedItems 與 insertedItems 順序一致
  // （單一 batch insert 保證回傳順序 = 傳入順序）可用 index 對應；否則要逐筆 insert。
  const allOptions = insertedItems.flatMap((item, i) =>
    preparedItems[i].options.map(opt => ({ ...opt, orderItemId: item.id })));
  const insertedOptions = allOptions.length
    ? await tx.insert(orderItemOptionTable).values(allOptions).returning()
    : [];
  return { order, items: insertedItems, options: insertedOptions }; // 手動組回巢狀形狀給呼叫端
});
```

**受影響檔案與各自的巢狀寫入複雜度**：

| 檔案 | 巢狀寫入內容 | 複雜度 |
|---|---|---|
| `create-order.ts` | Order → OrderItem → OrderItemOption（三層） | 高（見上方範例） |
| `admin-products.ts` | Product → ProductTranslation / ProductImage / ProductOptionGroup（並列，非巢狀階層） | 中 |
| `admin-option-groups.ts` | OptionGroup → OptionGroupTranslation / OptionItem → OptionItemTranslation（三層） | 高 |
| `admin-categories.ts` | Category → CategoryTranslation | 低 |
| `prisma/seed.ts` | Store → Category(ies) → CategoryTranslation；Product → Translation/Image/OptionGroup binding；OptionGroup → Item → Translation | 高（種子資料量大，建議寫一個共用的「批次巢狀 insert」helper 減少重複程式碼） |

**批次 insert 的回傳順序保證**：需在改寫時逐一查證 Drizzle + node-postgres 對單一 `insert().values([...]).returning()` 是否保證回傳順序與傳入順序一致（一般資料庫實務上會一致，但這是實作細節而非 SQL 標準保證的行為）；若不放心，改用 `INSERT ... RETURNING id` 搭配應用層自行配對，或每筆各自 insert（犧牲一點效能換取絕對正確，訂單建立這種低頻高正確性要求的路徑可以接受）。**此項列入 §9 必寫測試**。

### 4.3 巢狀更新（先刪後建 pattern）

現有程式碼對「整批替換翻譯／圖片／規格綁定」一律採「transaction 內先 `deleteMany` 再 `create`」（見 `admin-products.ts::updateProduct`、`admin-option-groups.ts::updateOptionGroup`）。這個 pattern **對 Drizzle 完全友善**，`deleteMany` → `tx.delete(table).where(...)`，`create` 部分套用 §4.2 的手動 insert 寫法即可，邏輯結構不變。

### 4.3a `$transaction([...])` 陣列形式 → 一律改成 callback 形式

Prisma 的 `$transaction` 有兩種寫法：callback 形式（`$transaction(async (tx) => {...})`，本文件前面範例都用這種）跟**陣列形式**（`$transaction([queryA, queryB])`，把預先建好的多個 query 一次送進去）。目前程式碼有兩處用了陣列形式：

- `admin-categories.ts::deleteCategory`：`prisma.$transaction([prisma.product.updateMany({...}), prisma.category.delete({...})])`
- `admin-option-groups.ts::deleteOptionGroup`：`prisma.$transaction([prisma.productOptionGroup.deleteMany({...}), prisma.optionGroup.delete({...})])`

**Drizzle 沒有陣列形式的 API**，只有 `db.transaction(async (tx) => {...})` 這一種。改寫時把陣列裡的每個 query 依序搬進 callback 內用 `await` 執行即可，語意完全等價（Prisma 的陣列形式本身也是包在同一個 DB transaction 內依序執行，不是平行執行）：

```ts
// Prisma
await prisma.$transaction([
  prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
  prisma.category.delete({ where: { id } }),
]);

// Drizzle
await db.transaction(async (tx) => {
  await tx.update(productTable).set({ categoryId: null }).where(eq(productTable.categoryId, id));
  await tx.delete(categoryTable).where(eq(categoryTable.id, id));
});
```

### 4.4 樂觀鎖狀態機（`updateMany` WHERE + affected-row-count）

`state-machine.ts::transition()` 是全專案唯一允許改 `Order.status` 的入口，核心邏輯：

```ts
// Prisma
const result = await tx.order.updateMany({
  where: { id: orderId, version: expectedVersion, status: { in: validFromStatuses } },
  data: { status: toStatus, version: { increment: 1 }, ...extraData },
});
if (result.count === 0) { /* 分辨 Conflict vs Invalid */ }

// Drizzle
const updated = await tx.update(orderTable)
  .set({ status: toStatus, version: sql`${orderTable.version} + 1`, ...extraData })
  .where(and(
    eq(orderTable.id, orderId),
    eq(orderTable.version, expectedVersion),
    inArray(orderTable.status, validFromStatuses),
  ))
  .returning({ id: orderTable.id });
if (updated.length === 0) { /* 分辨 Conflict vs Invalid，邏輯完全不變 */ }
```

**風險等級：高，但改寫本身直觀**。真正的風險是「這是全系統併發正確性的地基」，**改完必須重新跑過 `tests/state-machine.test.ts`（合法轉移全通過 + 所有非法轉移被拒的表格驅動測試）跟 `tests/pickup-number.test.ts`（併發 200 筆）才能判定改寫成功**，不能只看 typecheck 過。

### 4.5 原子計數器（`$queryRawUnsafe` → Drizzle 的 `sql` 標籤模板）

`counter.ts::nextSeq()` 用原始 SQL 做 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`。Drizzle 兩個選擇：

1. **保留原始 SQL**（風險最低，改動最小）：Drizzle 的 `sql` 標籤模板語法與 Prisma 的 `$queryRawUnsafe` 幾乎等價，直接搬：
   ```ts
   const rows = await tx.execute(sql`
     INSERT INTO ${sql.raw(table)} ("storeId","businessDate","lastSeq","updatedAt")
     VALUES (${storeId}, ${businessDate}, 1, NOW())
     ON CONFLICT ("storeId","businessDate")
     DO UPDATE SET "lastSeq" = ${sql.raw(table)}."lastSeq" + 1, "updatedAt" = NOW()
     RETURNING "lastSeq"
   `);
   ```
2. **改用 Drizzle 原生 upsert API**（`.insert(...).values(...).onConflictDoUpdate({ target: [...], set: { lastSeq: sql\`${table.lastSeq} + 1\` } })`）——更符合 Drizzle 慣例，但這裡 `table` 是動態決定的（`PickupCounter` vs `OrderNoCounter`），Drizzle 的型別化 API 不像原始 SQL 那樣容易做「表名參數化」，會需要一個 `if/else` 或 `Record<CounterTable, PgTable>` 查表分流。

**建議採用選項 1**：改動最小、風險最低，且原本的註解已解釋過「`table` 僅接受固定字面量，用 raw SQL 動態代入表名是安全的」，這個約束在 Drizzle 下依然成立，沒有理由为了「更 Drizzle 原生」而增加改寫風險。**此檔案是 SPEC §6.3/§6.4 的地基，`tests/pickup-number.test.ts` 的 200 併發測試是驗收唯一標準。**

### 4.6 Upsert + 原子累加（`upsert` with `increment`）

`daily-product-sales.ts::applyDailyProductSales()` 用 Prisma 的 `upsert` + `{ increment }`。Drizzle 對應 `onConflictDoUpdate`，用 `sql\`${column} + ${value}\`` 表達累加：

```ts
await tx.insert(dailyProductSales)
  .values({ storeId, businessDate, productId, productNameZh, quantitySold: isPaid ? qty : 0, ... })
  .onConflictDoUpdate({
    target: [dailyProductSales.storeId, dailyProductSales.businessDate, dailyProductSales.productId],
    set: {
      quantitySold: isPaid ? sql`${dailyProductSales.quantitySold} + ${qty}` : sql`${dailyProductSales.quantitySold}`,
      netQuantity: sql`${dailyProductSales.netQuantity} + ${isPaid ? qty : -qty}`,
      // ...其餘欄位同理
    },
  });
```

複雜度中等，逐欄位對照即可，`SPEC.md §11` 的統計口徑與測試（`tests/daily-product-sales.test.ts`）完全照搬驗證。

### 4.7 聚合與分組（`aggregate`/`groupBy` → 手寫 `sql` 聚合函式）

`stats/report.ts::getStatsSummary()` 用了 `_sum`/`_count`/`groupBy`。Drizzle 沒有 Prisma 那種 `_sum: { totalAmount: true }` 的型別化捷徑，要手寫 SQL 聚合函式：

```ts
// Prisma
prisma.order.aggregate({ where: {...}, _sum: { totalAmount: true }, _count: { _all: true } })

// Drizzle
db.select({
  sum: sql<number>`coalesce(sum(${orderTable.totalAmount}), 0)`,
  count: sql<number>`count(*)`,
}).from(orderTable).where(...)
```

```ts
// Prisma groupBy + orderBy on aggregate
prisma.dailyProductSales.groupBy({
  by: ["productId"], where: {...},
  _sum: { netQuantity: true, netAmount: true },
  orderBy: { _sum: { netQuantity: "desc" } }, take: 10,
})

// Drizzle
db.select({
  productId: dailyProductSales.productId,
  netQuantity: sql<number>`coalesce(sum(${dailyProductSales.netQuantity}), 0)`.as("net_quantity"),
  netAmount: sql<number>`coalesce(sum(${dailyProductSales.netAmount}), 0)`,
}).from(dailyProductSales).where(...)
  .groupBy(dailyProductSales.productId)
  .orderBy(desc(sql`net_quantity`))
  .limit(10)
```

`admin-categories.ts` 的 `_count: { select: { products: true } }`（關聯計數）同理，改成 `leftJoin` + `count(*)` + `groupBy`，或用子查詢。

**這是本次遷移「改寫後最需要人工覆查數字正確性」的一塊**——聚合函式手寫容易在 `coalesce`／型別轉換上出錯，**`tests/stats-rebuild.test.ts`（含退款情境，並與 `stats:rebuild` 結果比對）是這塊的驗收關卡，改寫後必須逐項比對輸出數字，不能只看有沒有噴錯**。

### 4.8 其他零散差異點

| 項目 | Prisma | Drizzle |
|---|---|---|
| 不存在時拋錯 | `findUniqueOrThrow` / `findFirstOrThrow` | 沒有內建等價物，需自己包一個 helper：`const row = await db.query.x.findFirst({...}); if (!row) throw new NotFoundError(...); return row;` |
| 唯一鍵衝突偵測 | `error.code === "P2002"`（Prisma 自己的錯誤碼） | node-postgres 原生錯誤有 `.code === "23505"`（Postgres unique_violation 的標準 SQLSTATE），改判斷這個 |
| 大小寫不敏感搜尋 | `{ contains: kw, mode: "insensitive" }` | `ilike(column, \`%${kw}%\`)` |
| 分頁 | `skip` / `take` | `.offset(n)` / `.limit(n)` |
| Enum 型別匯入 | `import { OrderStatus } from "@/generated/prisma/enums"` | Drizzle enum 需自行在 schema 檔匯出對應的 TS union type（`export type OrderStatus = (typeof orderStatusEnum.enumValues)[number]`），全專案 import 路徑要換 |
| `Prisma.TransactionClient` 型別 | 交易內的 client 型別 | Drizzle 對應型別是 `PgTransaction<...>` 或直接用 `typeof db`（依 driver 泛型而定），需要在改寫時定義一次共用型別別名，取代所有 `tx: Prisma.TransactionClient` 的函式簽章（`state-machine.ts`、`counter.ts`、`pickup-number.ts`、`order-no.ts`、`daily-product-sales.ts` 等） |
| 依關聯資料表欄位過濾 `deleteMany`／`findMany` | `where: { payment: { orderId: { in: ids } } } }`（直接穿過關聯過濾） | Drizzle 的 `.delete()`/`.select()` 不支援穿過 join 直接在 `where` 用關聯表欄位過濾，需改成子查詢或分兩步：先 `select` 出符合條件的關聯表 id 清單，再用 `inArray(column, [...ids])` 過濾。見 `scripts/cleanup-e2e-data.ts` 的 `paymentEvent`（依 `payment.orderId` 過濾）、`orderItemOption`（依 `orderItem.orderId` 過濾）兩處 |

---

## 5. Cloudflare Workers 整合（原本卡住的地方，現在應該直接消失）

### 5.1 `src/lib/db.ts` 改寫

現行架構（Workers 上每請求建立新 client、Node.js 本機沿用 module-level 單例）**架構本身不需要改**，只換掉 client 建構方式：

```ts
// 現行（Prisma）
const adapter = new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString, maxUses: 1 });
return new PrismaClient({ adapter });

// 改寫後（Drizzle，Cloudflare 官方推薦模式）
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
return drizzle(pool, { schema });
```

**這裡完全不需要任何 wasm、任何 generator runtime 設定、任何 `serverExternalPackages` 特殊處理**——`drizzle-orm/node-postgres` 就是純 TS 呼叫 `pg` 套件，跟目前專案已經在用、已經驗證能在 Workers 上正常運作的 `pg`／`pg-cloudflare` external 設定完全相容（`next.config.ts` 的 `serverExternalPackages: ["pg", "pg-cloudflare"]` 這兩條**維持不變**，因為 Drizzle 底層還是靠這兩個套件連線）。

### 5.2 需要移除的暫時性設定

遷移完成、確認正式站恢復正常後，清掉這次事故留下的所有暫時性/已失效設定：

- `prisma/schema.prisma` 整個檔案刪除（改為 `src/db/schema.ts`）。
- `.prisma/client`、`@prisma/client`、`@prisma/adapter-pg` 從 `next.config.ts` 的 `serverExternalPackages` 移除。
- `package.json` 的 `postinstall`/`db:generate`/`db:seed` 改指向 Drizzle 對應指令。
- `wrangler.jsonc` 檢查是否還殘留任何跟 wasm 嘗試相關的設定（依 `docs/OPEN-QUESTIONS.md` 的記錄，目前應該已經乾淨，但遷移前需再次確認）。

### 5.3 本機開發（`next dev`）與 `wrangler dev`／`opennextjs-cloudflare preview` 兩條路徑

現行 `db.ts` 用 `isCloudflareWorkersRuntime()` 判斷分流，這個機制**完全保留**，Drizzle 版本一樣需要「Workers 上每請求建立新連線 / 本機沿用單例」的差異化處理，只是 client 建構的那兩行程式碼換掉。

---

## 6. Migration 工具鏈與資料庫遷移策略

### 6.1 drizzle-kit 設定

新增 `drizzle.config.ts`（等價於 `prisma.config.ts` 的角色），指向 `src/db/schema.ts` 與 migration 輸出目錄 `drizzle/migrations/`。

### 6.2 既有 migration 歷史怎麼處理

目前只有 2 筆 Prisma migration（`20260815172226_init`、`20260815182441_add_order_idempotency_key`），資料庫結構單純，**採用「重新起一份 Drizzle baseline migration」策略**：

1. 用 `drizzle-kit generate` 依照新寫好的 `src/db/schema.ts` 產生**第一筆** Drizzle migration SQL。
2. 這筆 SQL 應該與目前資料庫的實際結構（也就是套用完兩筆 Prisma migration 後的結果）**完全一致**——這是最重要的驗證步驟，見 §9。
3. **正式環境／既有資料庫不重新建表**：Drizzle 的 migration 追蹤機制（`__drizzle_migrations` 表）需要「假裝」這筆 baseline 已經套用過，避免對已有資料的正式庫重跑 DDL。

   **已於 Phase 5 執行並驗證完成**（實作方式：讀 `node_modules/drizzle-orm/pg-core/dialect.js` 的 `PgDialect.migrate()` 原始碼確認機制——它會建立 `drizzle` schema 下的 `__drizzle_migrations` 表（`id serial, hash text, created_at bigint`），並用「最新一筆 `created_at` 是否 `<` 該筆 migration 的 `folderMillis`」判斷要不要重跑；`hash` 是 migration SQL 檔案內容的 sha256，`folderMillis` 取自 `drizzle/migrations/meta/_journal.json` 的 `when` 欄位）：
   1. 手動計算 baseline migration（`0000_opposite_mister_sinister.sql`）的 sha256 與對應的 `folderMillis`。
   2. 對本機 docker Postgres 與正式 Supabase 資料庫，各自手動 `CREATE SCHEMA IF NOT EXISTS drizzle` + `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (...)`，並 INSERT 這筆 `(hash, folderMillis)` 記錄，標記 baseline 為「已套用」。
   3. 用 `npm run db:migrate` 驗證兩邊資料庫都變成 no-op（`No schema changes, nothing to migrate` + `migrations applied successfully!`，不會嘗試重跑 `CREATE TYPE`/`CREATE TABLE`）。

   **事故記錄**：驗證過程中，一支未指定 `.env.test` 的除錯腳本誤用了預設 `.env`（其 `DATABASE_URL` 指向正式 Supabase，非本機 docker——這是專案原有、刻意的設定，本機開發/腳本本來就直接連正式庫），對正式庫執行了一次 migrate 嘗試。該次嘗試在交易內的第一句 `CREATE TYPE "AdminRole" ...` 就因型別已存在而失敗、整個交易回滾，未變更任何既有資料表結構；但交易外的 `CREATE SCHEMA`/`CREATE TABLE IF NOT EXISTS` 已對正式庫產生（無害的空追蹤表）。向使用者說明並取得確認後，比照本機做法在正式庫補上同一筆 baseline 記錄，兩邊資料庫狀態現已一致。
4. **本機開發／CI 測試資料庫**：baseline 策略比照正式環境處理（見上），未來 schema 變更走完整 `drizzle-kit generate && drizzle-kit migrate` 流程。
5. Prisma 的 `prisma/migrations/` 目錄整個保留在 git 歷史中（不刪除），僅新增 `drizzle/migrations/` 作為往後的唯一真實來源。`/api/health`（`src/app/api/health/route.ts`）已從查 `_prisma_migrations` 改為查 `drizzle.__drizzle_migrations`。

### 6.3 Schema 一致性驗證方法

遷移過程中最容易出錯的環節是「Drizzle schema 定義跟資料庫實際結構有落差」（尤其 §3.1 提到的 nullable 方向相反陷阱）。驗證方法：

```bash
# 對本機測試資料庫執行，比對 drizzle-kit 產生的 SQL 是否為「空 diff」
npx drizzle-kit generate --custom  # 若跟現有結構有落差，這裡會生出非預期的 ALTER TABLE
```

搭配直接查詢 `information_schema.columns`／`pg_indexes` 與 Prisma schema 逐欄位比對，人工過一次全部 18 個 model。

---

## 7. 連帶清理：這次事故留下的暫時性 workaround 要不要保留

遷移過程中順手評估、非本次遷移的強制項目：

| 項目 | 是否與 Prisma 有關 | 建議 |
|---|---|---|
| `src/app` 的 route group 重構（`(admin)`/`(dev)`/`(storefront)`/`(root)`） | **無關**，是修 `next build --webpack` 過程中發現的既有結構問題（缺少正確的多重 root layout） | **保留**，這是獨立於 ORM 的正確性修正，不因為放棄 webpack 路徑就該撤銷 |
| `prisma/schema.prisma` 的 `runtime = "workerd"` / `compilerBuild = "small"` | 有關，Drizzle 上線後這整個檔案都會被刪除 | 遷移完成後自然消失，不需要額外動作 |
| `@cf-wasm/photon` 圖片處理的 wasm 問題 | 無關（不同套件） | **不在本次遷移範圍**，另案處理，見 `docs/OPEN-QUESTIONS.md` |

---

## 8. 完整受影響檔案清單

### 8.1 新增

```
src/db/
├── schema.ts              # 取代 prisma/schema.prisma，含 pgTable + pgEnum + relations() 定義
├── relations.ts            # 或併入 schema.ts；視檔案大小決定是否拆分
drizzle.config.ts           # 取代 prisma.config.ts
drizzle/migrations/         # 取代 prisma/migrations/
```

### 8.2 修改（依受影響程度排序）

| 檔案 | 改動內容 | 風險 |
|---|---|---|
| `src/lib/db.ts` | client 建構方式（§5.1） | 低 |
| `src/server/order/state-machine.ts` | 樂觀鎖 `updateMany` → Drizzle（§4.4） | **高** |
| `src/server/order/counter.ts` | 原始 SQL UPSERT（§4.5） | **高** |
| `src/server/order/pickup-number.ts` | 呼叫端型別（`Prisma.TransactionClient` → Drizzle tx 型別） | 低 |
| `src/server/order/order-no.ts` | 與 `pickup-number.ts` 完全相同的呼叫模式（呼叫 `counter.ts::nextSeq`），已覆查確認無額外複雜度 | 低 |
| `src/server/order/create-order.ts` | 巢狀寫入 + 巢狀讀取 + P2002 判斷（§4.2, §4.8） | **高** |
| `src/server/order/admin-orders.ts` | 巢狀讀取 + 交易呼叫 | 中 |
| `src/server/order/expire-orders.ts` | 批次查詢 + count + 交易呼叫 | 中 |
| `src/server/order/get-order.ts` | 巢狀讀取 + JSON 欄位存取 | 低 |
| `src/server/payment/webhook.ts` | 巢狀讀取/寫入 + P2002 + 交易組合（transition + stats） | **高** |
| `src/server/payment/refund.ts` | 交易組合（update + transition + stats） | 中 |
| `src/server/payment/reconcile.ts` | 巢狀讀取 + 交易組合 | 中 |
| `src/server/payment/create-charge.ts` | 已覆查：巢狀讀取（`include: { items: true }`）+ 單一 `payment.create()` + JSON 欄位寫入，無巢狀寫入、無交易，符合原本低風險假設 | 低 |
| `src/server/catalog/get-menu.ts` | 深度巢狀讀取（§4.1） | 中 |
| `src/server/catalog/get-product.ts` | 深度巢狀讀取 | 中 |
| `src/server/catalog/admin-products.ts` | 巢狀寫入 + 大小寫不敏感搜尋 + 分頁 + count（§4.2, §4.3, §4.8） | **高** |
| `src/server/catalog/admin-option-groups.ts` | 三層巢狀寫入（§4.2, §4.3）+ `$transaction([...])` 陣列形式（§4.3a，`deleteOptionGroup`） | **高** |
| `src/server/catalog/admin-categories.ts` | 巢狀寫入 + 關聯計數（§4.7）+ `$transaction([...])` 陣列形式（§4.3a） | 中 |
| `src/server/stats/daily-product-sales.ts` | upsert + increment（§4.6） | **高** |
| `src/server/stats/rebuild.ts` | 批次讀取 + deleteMany/createMany 交易 | 中 |
| `src/server/stats/report.ts` | aggregate/groupBy 手寫 SQL（§4.7） | **高** |
| `src/server/admin/audit-log.ts` | 已覆查：單一 `auditLog.create()`，fire-and-forget、無交易，符合原本低風險假設 | 低 |
| `src/auth.ts` | 單純查詢/更新，改寫成本低 | 低 |
| `prisma/seed.ts` → 遷移為 `src/db/seed.ts` 或維持原路徑 | 大量巢狀寫入（§4.2） | 中（量大但模式重複） |
| `scripts/dev-mark-paid.ts` | 已覆查：呼叫既有的 `assignPickupNumber`/`transition`（§4.4/§4.5 已涵蓋），另用到 `findFirstOrThrow`/`findUniqueOrThrow`（§4.8 的手動 throw helper） | 低 |
| `scripts/cleanup-e2e-data.ts` | 已覆查：多筆 `deleteMany`，其中兩處用了「依關聯資料表欄位過濾」（`paymentEvent` 依 `payment.orderId`、`orderItemOption` 依 `orderItem.orderId`），Drizzle 需改寫成子查詢／兩步查詢（見 §4.8 新增條目），風險由低調整為中 | 中 |
| `scripts/rebuild-daily-sales.ts` | 呼叫 `rebuildDailyProductSales`，本身邏輯不變 | 低 |
| `tests/state-machine.test.ts` | 表格驅動測試，斷言方式需配合 Drizzle 查詢改寫，**測試案例本身（合法/非法轉移清單）不變** | 中 |
| `tests/pickup-number.test.ts` | 200 併發交易測試，**這是驗證 §4.5/§4.4 改寫是否正確的唯一標準** | **高**（測試改寫本身＋驗收把關雙重角色） |
| `tests/create-order.test.ts` | 需配合巢狀寫入改寫 | 中 |
| `tests/payment-webhook.test.ts` | 需配合交易改寫 | 中 |
| `tests/expire-orders.test.ts` | 需配合改寫 | 低 |
| `tests/reconcile-payments.test.ts` | 需配合改寫 | 低 |
| `tests/daily-product-sales.test.ts` | upsert+increment 驗證，**驗證 §4.6 改寫是否正確的標準** | 中 |
| `tests/stats-rebuild.test.ts` | 聚合數字驗證，**驗證 §4.7 改寫是否正確的標準** | 中 |
| `src/types/next-auth.d.ts` | `import { AdminRole } from "@/generated/prisma/enums"` 路徑改為 Drizzle enum type 匯出位置 | 低 |
| `src/lib/i18n/locale-map.ts` | `LocaleCode` enum 匯入路徑 | 低 |
| `src/lib/i18n/localize.ts` | 型別匯入路徑 | 低 |
| `src/lib/payment/types.ts` / `ecpay.ts` / `newebpay.ts` / `tappay.ts` / `mock.ts` | `PaymentStatus` 等 enum 匯入路徑 | 低 |
| `src/app/api/health/route.ts` | 健康檢查若直接呼叫 `$queryRaw`，改為 Drizzle `sql` | 低 |
| `next.config.ts` | 移除為 Prisma wasm 加的所有暫時設定（保留 `pg`/`pg-cloudflare` external） | 低 |
| `package.json` | script 更新（§6.1） | 低 |
| `wrangler.jsonc` | 確認無殘留 wasm 相關設定 | 低 |

### 8.3 刪除

```
prisma/schema.prisma
prisma.config.ts
src/generated/prisma/**          # Prisma 產生的整包程式碼
```

（`prisma/migrations/` 保留於 git 歷史，`prisma/seed.ts` 若原地改寫則保留路徑，若搬到 `src/db/seed.ts` 則此路徑刪除）

---

## 9. 驗收標準（比照 CLAUDE.md 的里程碑驗收規格）

```
### Drizzle 遷移完成

#### typecheck / lint / test
- `npm run typecheck && npm run lint && npm run test` 全綠

#### 逐一比對業務行為（不是「測試有過」就算數，是「數字/行為與遷移前一致」）
- [ ] tests/state-machine.test.ts：合法轉移全通過 + 所有非法轉移被拒（表格內容與遷移前逐條相同）
- [ ] tests/pickup-number.test.ts：併發 200 筆不重號、跨 cutoff 重置、超上限進位——三種情境全過
- [ ] tests/create-order.test.ts：選項驗證錯誤情境、金額重算、Idempotency-Key 重送
- [ ] tests/payment-webhook.test.ts：驗簽失敗、重複事件、金額不符三種情境
- [ ] tests/stats-rebuild.test.ts：含退款情境，且與 `npm run stats:rebuild` 實際執行結果比對數字完全一致
- [ ] tests/daily-product-sales.test.ts：upsert+increment 累加正確
- [ ] tests/expire-orders.test.ts / tests/reconcile-payments.test.ts：批次流程正確

#### Cloudflare Workers 正式部署驗證
- [ ] `npm run cf:build` 成功（Turbopack，不需要 `--webpack`）
- [ ] `npx opennextjs-cloudflare preview` 本機驗證 `/zh-TW` 首頁回 200（這是本次事故最初的故障點）
- [ ] `/admin/*` 後台頁面正常（含商品 CRUD、訂單狀態變更、統計報表）
- [ ] 完整下單流程（含 Mock 付款）在本機 preview 環境跑通一次
- [ ] 部署到正式站後，比照本文件開頭的故障排除方式，確認 `curl` 回 200 且無 console error

#### Schema 一致性
- [ ] 依 §6.3 方法確認 Drizzle schema 與資料庫實際結構零落差
- [ ] 18 個 model 的欄位 nullable 方向（§3.1 陷阱）逐一人工覆查一次
```

---

## 10. 分階段執行順序（呼應 CLAUDE.md「一次只做一個里程碑」原則）

不建議一次性大爆炸式改完全部再測試，建議拆成以下順序，**每階段都跑一次相關測試再進下一階段**：

1. **Phase 0 — 準備**：安裝套件、寫 `src/db/schema.ts`（含 relations）、`drizzle.config.ts`、跑 §6.3 的 schema 一致性驗證，此階段不動任何 `server/**` 程式碼。
2. **Phase 1 — 唯讀路徑**：`get-menu.ts`／`get-product.ts`／`get-order.ts`／`report.ts` 等純讀取模組先改（風險較低、無交易/併發顧慮），驗證 API 回應與遷移前逐欄位比對一致。
3. **Phase 2 — 地基模組**：`state-machine.ts`／`counter.ts`／`pickup-number.ts`／`daily-product-sales.ts`——全系統其他模組都依賴這幾個，優先改完並讓 `tests/pickup-number.test.ts`／`tests/state-machine.test.ts` 全過。
4. **Phase 3 — 訂單與金流寫入路徑**：`create-order.ts`／`webhook.ts`／`refund.ts`／`reconcile.ts`／`admin-orders.ts`／`expire-orders.ts`。
5. **Phase 4 — 後台 CRUD**：`admin-products.ts`／`admin-option-groups.ts`／`admin-categories.ts`／`auth.ts`。
6. **Phase 5 — 收尾**：`seed.ts`／`scripts/*.ts`／`db.ts` 的 Cloudflare 分支、刪除 Prisma 殘留檔案、`next.config.ts`/`wrangler.jsonc` 清理。
7. **Phase 6 — 部署驗證**：依 §9 的部署驗證清單，在本機 `opennextjs-cloudflare preview` 確認後才實際部署正式站。

---

## 11. 待確認事項（依 CLAUDE.md 慣例，開工前寫入 docs/OPEN-QUESTIONS.md 並標註暫定假設）

- Drizzle 具體鎖定版本號（本文件寫作時未鎖定，開工前需查最新穩定版並鎖 lockfile，比照 CLAUDE.md「版本為下限」原則）。
- `drizzle-kit` baseline migration 對「既有正式資料庫」的追蹤表處理方式，需要在正式環境操作前於本機測試資料庫完整演練一次（見 §6.2 步驟 3），避免對正式資料庫誤跑 DDL。
- ~~`admin-categories.ts` / `create-charge.ts` / `audit-log.ts` / `scripts/dev-mark-paid.ts` / `scripts/cleanup-e2e-data.ts` 這幾個檔案本文件撰寫時只看過部分或未逐行讀完~~ ——**2026-08-17 已全部逐行覆查完畢**，發現兩個原本規劃時沒涵蓋到的模式並已補進文件：`$transaction([...])` 陣列形式（§4.3a，影響 `admin-categories.ts`／`admin-option-groups.ts`）、依關聯資料表欄位過濾的 `deleteMany`（§4.8 表格新增條目，影響 `scripts/cleanup-e2e-data.ts`，風險由低調整為中）。§8.2 檔案清單已同步更新。
