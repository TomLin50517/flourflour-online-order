// 見 docs/DRIZZLE-MIGRATION-SPEC.md：取代 prisma/schema.prisma。
// 欄位語意、資料表/欄位名稱（含大小寫）、index/constraint 名稱、外鍵 onDelete/onUpdate
// 行為，皆逐一對照本機資料庫實際結構（`information_schema.columns`／`pg_indexes`／
// `pg_constraint`）核對過，確保跟既有資料庫零落差，不需要重建任何資料表。
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

// ---------- Enums ----------
export const localeCodeEnum = pgEnum("LocaleCode", ["ZH_TW", "EN", "JA", "KO"]);
export type LocaleCode = (typeof localeCodeEnum.enumValues)[number];

export const orderStatusEnum = pgEnum("OrderStatus", [
  "PENDING_PAYMENT", // 已建單，等待付款
  "PAID", // 付款成功（此時配發 pickupNumber）
  "PREPARING", // 製作中
  "READY", // 可取餐（叫號中）
  "COMPLETED", // 已取餐
  "CANCELLED", // 已取消（未付款逾時或店家取消）
  "REFUNDED", // 已退款
]);
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

export const paymentStatusEnum = pgEnum("PaymentStatus", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

export const optionSelectTypeEnum = pgEnum("OptionSelectType", ["SINGLE", "MULTIPLE"]);
export type OptionSelectType = (typeof optionSelectTypeEnum.enumValues)[number];

export const adminRoleEnum = pgEnum("AdminRole", ["ADMIN", "STAFF"]);
export type AdminRole = (typeof adminRoleEnum.enumValues)[number];

// 共用的 cuid() id 欄位定義。見 docs/DRIZZLE-MIGRATION-SPEC.md §3.1：
// Prisma 的 cuid() 是應用層產生（非 DB default），改用 @paralleldrive/cuid2
// 在 insert 當下算好塞進去；既有資料的 cuid1 格式 id 不受影響（純 opaque 字串，
// 專案內沒有任何地方用 Zod .cuid() 驗證格式，已於動工前確認過）。
function cuidPk() {
  return text("id").primaryKey().$defaultFn(() => createId());
}

// timestamp(3) without time zone，對應 Prisma 的 DateTime（未加 @db.Timestamptz）。
function ts(name: string) {
  return timestamp(name, { precision: 3, mode: "date" });
}

// ---------- Store ----------
export const store = pgTable("Store", {
  id: cuidPk(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Taipei"),
  currency: text("currency").notNull().default("TWD"),
  // 營業日切換時間（HH:mm，本地時間）。凌晨營業的店家用此界定「當日」
  businessDayCutoff: text("businessDayCutoff").notNull().default("04:00"),
  // 取貨單號設定
  pickupPrefix: text("pickupPrefix").notNull().default("A"),
  pickupPadding: integer("pickupPadding").notNull().default(3), // A001
  pickupMax: integer("pickupMax").notNull().default(999), // 超過則回捲並換前綴，見 SPEC.md §6.3
  isOpen: boolean("isOpen").notNull().default(true),
  createdAt: ts("createdAt").notNull().defaultNow(),
  updatedAt: ts("updatedAt")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

export const storeRelations = relations(store, ({ many }) => ({
  categories: many(category),
  products: many(product),
  orders: many(order),
  optionGroups: many(optionGroup),
}));

// ---------- Catalog ----------
export const category = pgTable(
  "Category",
  {
    id: cuidPk(),
    storeId: text("storeId").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sortOrder").notNull().default(0),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: ts("createdAt").notNull().defaultNow(),
    updatedAt: ts("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("Category_storeId_slug_key").on(t.storeId, t.slug),
    index("Category_storeId_sortOrder_idx").on(t.storeId, t.sortOrder),
    foreignKey({ name: "Category_storeId_fkey", columns: [t.storeId], foreignColumns: [store.id] })
      .onDelete("restrict")
      .onUpdate("cascade"),
  ],
);

export const categoryRelations = relations(category, ({ one, many }) => ({
  store: one(store, { fields: [category.storeId], references: [store.id] }),
  translations: many(categoryTranslation),
  products: many(product),
}));

export const categoryTranslation = pgTable(
  "CategoryTranslation",
  {
    id: cuidPk(),
    categoryId: text("categoryId").notNull(),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(),
  },
  (t) => [
    uniqueIndex("CategoryTranslation_categoryId_locale_key").on(t.categoryId, t.locale),
    foreignKey({
      name: "CategoryTranslation_categoryId_fkey",
      columns: [t.categoryId],
      foreignColumns: [category.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const categoryTranslationRelations = relations(categoryTranslation, ({ one }) => ({
  category: one(category, { fields: [categoryTranslation.categoryId], references: [category.id] }),
}));

export const product = pgTable(
  "Product",
  {
    id: cuidPk(),
    storeId: text("storeId").notNull(),
    categoryId: text("categoryId"),
    slug: text("slug").notNull(), // URL 用，英數，語系無關
    sku: text("sku"), // 店家自訂編號
    basePrice: integer("basePrice").notNull(), // 最小貨幣單位；TWD 即元
    sortOrder: integer("sortOrder").notNull().default(0),
    isActive: boolean("isActive").notNull().default(true), // 上架/下架
    isSoldOut: boolean("isSoldOut").notNull().default(false), // 今日售完（每日 cutoff 自動歸 false）
    createdAt: ts("createdAt").notNull().defaultNow(),
    updatedAt: ts("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    deletedAt: ts("deletedAt"), // 軟刪除；有訂單引用的商品不得硬刪
  },
  (t) => [
    uniqueIndex("Product_storeId_slug_key").on(t.storeId, t.slug),
    index("Product_storeId_categoryId_sortOrder_idx").on(t.storeId, t.categoryId, t.sortOrder),
    index("Product_storeId_isActive_deletedAt_idx").on(t.storeId, t.isActive, t.deletedAt),
    foreignKey({ name: "Product_storeId_fkey", columns: [t.storeId], foreignColumns: [store.id] })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({ name: "Product_categoryId_fkey", columns: [t.categoryId], foreignColumns: [category.id] })
      .onDelete("set null")
      .onUpdate("cascade"),
  ],
);

export const productRelations = relations(product, ({ one, many }) => ({
  store: one(store, { fields: [product.storeId], references: [store.id] }),
  category: one(category, { fields: [product.categoryId], references: [category.id] }),
  translations: many(productTranslation),
  images: many(productImage),
  optionGroups: many(productOptionGroup),
  orderItems: many(orderItem),
}));

export const productTranslation = pgTable(
  "ProductTranslation",
  {
    id: cuidPk(),
    productId: text("productId").notNull(),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(), // 產品名稱
    description: text("description"), // 簡介
  },
  (t) => [
    uniqueIndex("ProductTranslation_productId_locale_key").on(t.productId, t.locale),
    foreignKey({
      name: "ProductTranslation_productId_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const productTranslationRelations = relations(productTranslation, ({ one }) => ({
  product: one(product, { fields: [productTranslation.productId], references: [product.id] }),
}));

export const productImage = pgTable(
  "ProductImage",
  {
    id: cuidPk(),
    productId: text("productId").notNull(),
    url: text("url").notNull(), // 物件儲存的公開 URL
    altText: text("altText"), // 無障礙用；可選填，缺則用 zh-TW 品名
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sortOrder: integer("sortOrder").notNull().default(0),
    isPrimary: boolean("isPrimary").notNull().default(false), // 每個商品僅一張 true（應用層保證）
  },
  (t) => [
    index("ProductImage_productId_sortOrder_idx").on(t.productId, t.sortOrder),
    foreignKey({
      name: "ProductImage_productId_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const productImageRelations = relations(productImage, ({ one }) => ({
  product: one(product, { fields: [productImage.productId], references: [product.id] }),
}));

// ---------- Options（規格：尺寸、甜度、加料…） ----------
export const optionGroup = pgTable(
  "OptionGroup",
  {
    id: cuidPk(),
    storeId: text("storeId").notNull(),
    code: text("code").notNull(), // 內部識別，如 "size"
    selectType: optionSelectTypeEnum("selectType").notNull().default("SINGLE"),
    minSelect: integer("minSelect").notNull().default(1), // SINGLE 必選=1，非必選=0
    maxSelect: integer("maxSelect").notNull().default(1), // MULTIPLE 時 >1
    isActive: boolean("isActive").notNull().default(true),
  },
  (t) => [
    uniqueIndex("OptionGroup_storeId_code_key").on(t.storeId, t.code),
    foreignKey({ name: "OptionGroup_storeId_fkey", columns: [t.storeId], foreignColumns: [store.id] })
      .onDelete("restrict")
      .onUpdate("cascade"),
  ],
);

export const optionGroupRelations = relations(optionGroup, ({ one, many }) => ({
  store: one(store, { fields: [optionGroup.storeId], references: [store.id] }),
  translations: many(optionGroupTranslation),
  items: many(optionItem),
  products: many(productOptionGroup),
}));

export const optionGroupTranslation = pgTable(
  "OptionGroupTranslation",
  {
    id: cuidPk(),
    groupId: text("groupId").notNull(),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(), // 「尺寸」/「Size」/「サイズ」/「사이즈」
  },
  (t) => [
    uniqueIndex("OptionGroupTranslation_groupId_locale_key").on(t.groupId, t.locale),
    foreignKey({
      name: "OptionGroupTranslation_groupId_fkey",
      columns: [t.groupId],
      foreignColumns: [optionGroup.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const optionGroupTranslationRelations = relations(optionGroupTranslation, ({ one }) => ({
  group: one(optionGroup, { fields: [optionGroupTranslation.groupId], references: [optionGroup.id] }),
}));

export const optionItem = pgTable(
  "OptionItem",
  {
    id: cuidPk(),
    groupId: text("groupId").notNull(),
    code: text("code").notNull(), // 如 "large"
    priceDelta: integer("priceDelta").notNull().default(0), // 可為負；加價/折抵
    sortOrder: integer("sortOrder").notNull().default(0),
    isActive: boolean("isActive").notNull().default(true),
    isDefault: boolean("isDefault").notNull().default(false),
  },
  (t) => [
    uniqueIndex("OptionItem_groupId_code_key").on(t.groupId, t.code),
    foreignKey({
      name: "OptionItem_groupId_fkey",
      columns: [t.groupId],
      foreignColumns: [optionGroup.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const optionItemRelations = relations(optionItem, ({ one, many }) => ({
  group: one(optionGroup, { fields: [optionItem.groupId], references: [optionGroup.id] }),
  translations: many(optionItemTranslation),
}));

export const optionItemTranslation = pgTable(
  "OptionItemTranslation",
  {
    id: cuidPk(),
    itemId: text("itemId").notNull(),
    locale: localeCodeEnum("locale").notNull(),
    name: text("name").notNull(),
  },
  (t) => [
    uniqueIndex("OptionItemTranslation_itemId_locale_key").on(t.itemId, t.locale),
    foreignKey({
      name: "OptionItemTranslation_itemId_fkey",
      columns: [t.itemId],
      foreignColumns: [optionItem.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const optionItemTranslationRelations = relations(optionItemTranslation, ({ one }) => ({
  item: one(optionItem, { fields: [optionItemTranslation.itemId], references: [optionItem.id] }),
}));

// 商品 ↔ 規格群組（多對多 + 排序 + 覆寫必填）
export const productOptionGroup = pgTable(
  "ProductOptionGroup",
  {
    productId: text("productId").notNull(),
    groupId: text("groupId").notNull(),
    sortOrder: integer("sortOrder").notNull().default(0),
    isRequired: boolean("isRequired").notNull().default(true),
  },
  (t) => [
    primaryKey({ name: "ProductOptionGroup_pkey", columns: [t.productId, t.groupId] }),
    foreignKey({
      name: "ProductOptionGroup_productId_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "ProductOptionGroup_groupId_fkey",
      columns: [t.groupId],
      foreignColumns: [optionGroup.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const productOptionGroupRelations = relations(productOptionGroup, ({ one }) => ({
  product: one(product, { fields: [productOptionGroup.productId], references: [product.id] }),
  group: one(optionGroup, { fields: [productOptionGroup.groupId], references: [optionGroup.id] }),
}));

// ---------- Order ----------
export const order = pgTable(
  "Order",
  {
    id: cuidPk(),
    storeId: text("storeId").notNull(),
    orderNo: text("orderNo").notNull(), // 對外訂單編號 ORD-20260815-0001
    accessToken: text("accessToken").notNull(), // 訪客查單憑證（32 bytes hex）
    idempotencyKey: text("idempotencyKey").notNull(), // 見 docs/OPEN-QUESTIONS.md：SPEC §8.2 要求但原欄位表未列
    status: orderStatusEnum("status").notNull().default("PENDING_PAYMENT"),
    version: integer("version").notNull().default(0), // 樂觀鎖

    locale: localeCodeEnum("locale").notNull(), // 下單當下語系（用於通知與收據）
    currency: text("currency").notNull().default("TWD"),

    subtotalAmount: integer("subtotalAmount").notNull(), // 品項小計總和
    discountAmount: integer("discountAmount").notNull().default(0), // v1 恆為 0，欄位預留
    totalAmount: integer("totalAmount").notNull(), // = subtotal - discount

    // 取貨（店內自取叫號）
    pickupNumber: text("pickupNumber"), // 付款成功才配發，如 "A013"
    businessDate: date("businessDate", { mode: "date" }), // 配號所屬營業日
    pickupSeq: integer("pickupSeq"), // 當日序號（排序/稽核用）

    customerName: text("customerName"),
    customerPhone: text("customerPhone"),
    customerNote: text("customerNote"),

    placedAt: ts("placedAt").notNull().defaultNow(),
    paidAt: ts("paidAt"),
    readyAt: ts("readyAt"),
    completedAt: ts("completedAt"),
    cancelledAt: ts("cancelledAt"),
    cancelReason: text("cancelReason"),
    expiresAt: ts("expiresAt").notNull(), // 未付款逾時時間（預設 placedAt + 15 分）
  },
  (t) => [
    uniqueIndex("Order_orderNo_key").on(t.orderNo),
    uniqueIndex("Order_accessToken_key").on(t.accessToken),
    uniqueIndex("Order_idempotencyKey_key").on(t.idempotencyKey),
    uniqueIndex("Order_storeId_businessDate_pickupSeq_key").on(t.storeId, t.businessDate, t.pickupSeq), // 同營業日序號唯一
    index("Order_storeId_status_placedAt_idx").on(t.storeId, t.status, t.placedAt),
    index("Order_storeId_businessDate_idx").on(t.storeId, t.businessDate),
    index("Order_status_expiresAt_idx").on(t.status, t.expiresAt), // 逾時清理 job 用
    foreignKey({ name: "Order_storeId_fkey", columns: [t.storeId], foreignColumns: [store.id] })
      .onDelete("restrict")
      .onUpdate("cascade"),
  ],
);

export const orderRelations = relations(order, ({ one, many }) => ({
  store: one(store, { fields: [order.storeId], references: [store.id] }),
  items: many(orderItem),
  payments: many(payment),
  events: many(orderEvent),
}));

export const orderItem = pgTable(
  "OrderItem",
  {
    id: cuidPk(),
    orderId: text("orderId").notNull(),
    productId: text("productId").notNull(), // 僅供關聯查詢，顯示一律用快照
    quantity: integer("quantity").notNull(),

    // ---- 快照（下單當下凍結，永不隨商品變更） ----
    nameSnapshot: jsonb("nameSnapshot").notNull().$type<Record<LocaleCode, string>>(), // { "ZH_TW": "珍珠奶茶", "EN": "...", "JA": "...", "KO": "..." }
    imageUrlSnapshot: text("imageUrlSnapshot"),
    unitBasePrice: integer("unitBasePrice").notNull(), // 商品基礎單價
    unitOptionsPrice: integer("unitOptionsPrice").notNull(), // 該品項所有選項加總（單份）
    unitPrice: integer("unitPrice").notNull(), // = unitBasePrice + unitOptionsPrice
    lineTotal: integer("lineTotal").notNull(), // = unitPrice * quantity
  },
  (t) => [
    index("OrderItem_orderId_idx").on(t.orderId),
    index("OrderItem_productId_idx").on(t.productId),
    foreignKey({ name: "OrderItem_orderId_fkey", columns: [t.orderId], foreignColumns: [order.id] })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({ name: "OrderItem_productId_fkey", columns: [t.productId], foreignColumns: [product.id] })
      .onDelete("restrict")
      .onUpdate("cascade"),
  ],
);

export const orderItemRelations = relations(orderItem, ({ one, many }) => ({
  order: one(order, { fields: [orderItem.orderId], references: [order.id] }),
  product: one(product, { fields: [orderItem.productId], references: [product.id] }),
  options: many(orderItemOption),
}));

export const orderItemOption = pgTable(
  "OrderItemOption",
  {
    id: cuidPk(),
    orderItemId: text("orderItemId").notNull(),
    optionItemId: text("optionItemId").notNull(),
    groupNameSnapshot: jsonb("groupNameSnapshot").notNull().$type<Record<LocaleCode, string>>(), // 同上，四語系
    itemNameSnapshot: jsonb("itemNameSnapshot").notNull().$type<Record<LocaleCode, string>>(),
    priceDelta: integer("priceDelta").notNull(),
  },
  (t) => [
    index("OrderItemOption_orderItemId_idx").on(t.orderItemId),
    foreignKey({
      name: "OrderItemOption_orderItemId_fkey",
      columns: [t.orderItemId],
      foreignColumns: [orderItem.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const orderItemOptionRelations = relations(orderItemOption, ({ one }) => ({
  orderItem: one(orderItem, { fields: [orderItemOption.orderItemId], references: [orderItem.id] }),
}));

// 訂單稽核軌跡
export const orderEvent = pgTable(
  "OrderEvent",
  {
    id: cuidPk(),
    orderId: text("orderId").notNull(),
    fromStatus: orderStatusEnum("fromStatus"),
    toStatus: orderStatusEnum("toStatus").notNull(),
    actorType: text("actorType").notNull(), // "SYSTEM" | "STAFF" | "PAYMENT_WEBHOOK"
    actorId: text("actorId"),
    note: text("note"),
    createdAt: ts("createdAt").notNull().defaultNow(),
  },
  (t) => [
    index("OrderEvent_orderId_createdAt_idx").on(t.orderId, t.createdAt),
    foreignKey({ name: "OrderEvent_orderId_fkey", columns: [t.orderId], foreignColumns: [order.id] })
      .onDelete("cascade")
      .onUpdate("cascade"),
  ],
);

export const orderEventRelations = relations(orderEvent, ({ one }) => ({
  order: one(order, { fields: [orderEvent.orderId], references: [order.id] }),
}));

// ---------- Payment ----------
export const payment = pgTable(
  "Payment",
  {
    id: cuidPk(),
    orderId: text("orderId").notNull(),
    provider: text("provider").notNull(), // "ecpay" | "newebpay" | "tappay" | "mock"
    providerRef: text("providerRef"), // 廠商交易序號
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("TWD"),
    method: text("method"), // "CREDIT_CARD" 等
    cardLast4: text("cardLast4"),
    cardBrand: text("cardBrand"),
    failureCode: text("failureCode"),
    failureMessage: text("failureMessage"),
    idempotencyKey: text("idempotencyKey").notNull(),
    rawRequest: jsonb("rawRequest").$type<unknown>(), // 遮蔽後的請求（不得含完整卡號/CVV）
    rawResponse: jsonb("rawResponse").$type<unknown>(),
    createdAt: ts("createdAt").notNull().defaultNow(),
    paidAt: ts("paidAt"),
    refundedAt: ts("refundedAt"),
  },
  (t) => [
    uniqueIndex("Payment_idempotencyKey_key").on(t.idempotencyKey),
    index("Payment_orderId_idx").on(t.orderId),
    index("Payment_provider_providerRef_idx").on(t.provider, t.providerRef),
    foreignKey({ name: "Payment_orderId_fkey", columns: [t.orderId], foreignColumns: [order.id] })
      .onDelete("restrict")
      .onUpdate("cascade"),
  ],
);

export const paymentRelations = relations(payment, ({ one, many }) => ({
  order: one(order, { fields: [payment.orderId], references: [order.id] }),
  events: many(paymentEvent),
}));

// Webhook 去重與稽核
export const paymentEvent = pgTable(
  "PaymentEvent",
  {
    id: cuidPk(),
    paymentId: text("paymentId"),
    provider: text("provider").notNull(),
    providerEventId: text("providerEventId").notNull(), // 廠商事件 ID，用於冪等
    eventType: text("eventType").notNull(),
    payload: jsonb("payload").notNull().$type<unknown>(),
    signatureValid: boolean("signatureValid").notNull(),
    processedAt: ts("processedAt"),
    createdAt: ts("createdAt").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("PaymentEvent_provider_providerEventId_key").on(t.provider, t.providerEventId), // ★ Webhook 冪等的關鍵
    foreignKey({
      name: "PaymentEvent_paymentId_fkey",
      columns: [t.paymentId],
      foreignColumns: [payment.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
  ],
);

export const paymentEventRelations = relations(paymentEvent, ({ one }) => ({
  payment: one(payment, { fields: [paymentEvent.paymentId], references: [payment.id] }),
}));

// ---------- 序號配發 ----------
// 取餐號序號（付款成功時遞增）。只透過原始 SQL UPSERT 操作（見 server/order/counter.ts），
// 這裡的欄位定義本身不會被 Drizzle query builder 直接呼叫。
export const pickupCounter = pgTable(
  "PickupCounter",
  {
    storeId: text("storeId").notNull(),
    businessDate: date("businessDate", { mode: "date" }).notNull(),
    lastSeq: integer("lastSeq").notNull().default(0),
    updatedAt: ts("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ name: "PickupCounter_pkey", columns: [t.storeId, t.businessDate] })],
);

// 訂單編號序號（建單時遞增，與取貨號獨立計數）
export const orderNoCounter = pgTable(
  "OrderNoCounter",
  {
    storeId: text("storeId").notNull(),
    businessDate: date("businessDate", { mode: "date" }).notNull(),
    lastSeq: integer("lastSeq").notNull().default(0),
    updatedAt: ts("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ name: "OrderNoCounter_pkey", columns: [t.storeId, t.businessDate] })],
);

// ---------- 統計（物化表） ----------
export const dailyProductSales = pgTable(
  "DailyProductSales",
  {
    storeId: text("storeId").notNull(),
    businessDate: date("businessDate", { mode: "date" }).notNull(),
    productId: text("productId").notNull(),
    productNameZh: text("productNameZh").notNull(), // 冗餘存放，商品改名後報表仍可讀
    quantitySold: integer("quantitySold").notNull().default(0), // 認列口徑見 SPEC.md §11
    grossAmount: integer("grossAmount").notNull().default(0),
    refundedQty: integer("refundedQty").notNull().default(0),
    refundedAmount: integer("refundedAmount").notNull().default(0),
    netQuantity: integer("netQuantity").notNull().default(0), // = quantitySold - refundedQty
    netAmount: integer("netAmount").notNull().default(0),
    updatedAt: ts("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ name: "DailyProductSales_pkey", columns: [t.storeId, t.businessDate, t.productId] }),
    index("DailyProductSales_storeId_businessDate_idx").on(t.storeId, t.businessDate),
  ],
);

// ---------- 後台帳號 ----------
export const adminUser = pgTable(
  "AdminUser",
  {
    id: cuidPk(),
    email: text("email").notNull(),
    passwordHash: text("passwordHash").notNull(),
    displayName: text("displayName").notNull(),
    role: adminRoleEnum("role").notNull().default("STAFF"),
    isActive: boolean("isActive").notNull().default(true),
    lastLoginAt: ts("lastLoginAt"),
    createdAt: ts("createdAt").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("AdminUser_email_key").on(t.email)],
);

export const auditLog = pgTable(
  "AuditLog",
  {
    id: cuidPk(),
    actorId: text("actorId"),
    action: text("action").notNull(), // "product.update" 等
    targetType: text("targetType").notNull(),
    targetId: text("targetId").notNull(),
    diff: jsonb("diff").$type<unknown>(),
    ip: text("ip"),
    createdAt: ts("createdAt").notNull().defaultNow(),
  },
  (t) => [index("AuditLog_targetType_targetId_createdAt_idx").on(t.targetType, t.targetId, t.createdAt)],
);
