import { revalidateTag } from "next/cache";
import { and, asc, eq, exists, ilike, inArray, isNull, sql } from "drizzle-orm";
import { LOCALES } from "@/lib/i18n/locale-map";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { getDb, type DbOrTx } from "@/db/client";
import { orThrow } from "@/db/helpers";
import {
  optionGroup as optionGroupTable,
  product as productTable,
  productImage as productImageTable,
  productOptionGroup as productOptionGroupTable,
  productTranslation as productTranslationTable,
} from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/server/admin/audit-log";

type TranslationInput = { locale: Locale; name: string; description?: string };
type ImageInput = {
  url: string;
  width: number;
  height: number;
  altText?: string;
  isPrimary?: boolean;
  sortOrder?: number;
};

function translationRows(translations: TranslationInput[]) {
  return translations.map((t) => ({
    locale: toDbLocale(t.locale),
    name: t.name,
    description: t.description,
  }));
}

function assertFourTranslations(translations: TranslationInput[]) {
  const locales = new Set(translations.map((t) => t.locale));
  if (translations.length !== 4 || LOCALES.some((l) => !locales.has(l))) {
    throw new ValidationError("必須提供完整的四語系翻譯（zh-TW/en/ja/ko）");
  }
}

export async function listProductsAdmin(filters: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  categoryId?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  // 見 docs/DRIZZLE-MIGRATION-SPEC.md：relational query API（`db.query.product`）
  // 內部會把 Product 表另外取別名，直接沿用 top-level 的 `productTable` 參照組出的
  // EXISTS 子查詢條件，套進 relational query 會對不到別名而噴 SQL 錯誤（`invalid
  // reference to FROM-clause entry for table "Product"`，只有實際下查詢才會發現，
  // typecheck 不會擋）。改成用一個接受表參照的函式，分別餵 relational query callback
  // 給的別名表參照、跟 plain `.select()` 用的原始表參照。
  function buildWhere(p: {
    storeId: typeof productTable.storeId;
    deletedAt: typeof productTable.deletedAt;
    categoryId: typeof productTable.categoryId;
    isActive: typeof productTable.isActive;
    id: typeof productTable.id;
  }) {
    const conditions = [eq(p.storeId, store.id), isNull(p.deletedAt)];
    if (filters.categoryId) conditions.push(eq(p.categoryId, filters.categoryId));
    if (filters.isActive !== undefined) conditions.push(eq(p.isActive, filters.isActive));
    if (filters.keyword) {
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(productTranslationTable)
            .where(
              and(
                eq(productTranslationTable.productId, p.id),
                ilike(productTranslationTable.name, `%${filters.keyword}%`),
              ),
            ),
        ),
      );
    }
    return and(...conditions);
  }

  const [totalRows, products] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(productTable).where(buildWhere(productTable)),
    db.query.product.findMany({
      where: (p) => buildWhere(p),
      orderBy: [asc(productTable.sortOrder)],
      offset: (page - 1) * pageSize,
      limit: pageSize,
      with: {
        translations: true,
        images: { where: (img, { eq }) => eq(img.isPrimary, true), limit: 1 },
        category: { with: { translations: true } },
      },
    }),
  ]);

  return { total: totalRows[0]?.count ?? 0, page, pageSize, products };
}

export async function getProductAdmin(id: string) {
  const db = await getDb();
  const product = await db.query.product.findFirst({
    where: eq(productTable.id, id),
    with: {
      translations: true,
      images: { orderBy: (img, { asc }) => asc(img.sortOrder) },
      optionGroups: { with: { group: { with: { translations: true } } } },
    },
  });
  if (!product) throw new NotFoundError("商品不存在");
  return product;
}

function assertActivationInvariants(
  translationCount: number,
  images: { isPrimary?: boolean }[],
) {
  // 見 SPEC.md §5.2 INV-1 / INV-2
  if (translationCount !== 4) {
    throw new ValidationError("上架前必須有完整的四語系翻譯");
  }
  if (images.length === 0) {
    throw new ValidationError("上架前必須至少有一張商品圖片");
  }
  if (images.filter((img) => img.isPrimary).length !== 1) {
    throw new ValidationError("商品必須恰好有一張主圖");
  }
}

export async function createProduct(
  input: {
    slug: string;
    sku?: string;
    categoryId?: string;
    basePrice: number;
    sortOrder?: number;
    translations: TranslationInput[];
    optionGroupIds: string[];
  },
  actorId: string,
) {
  assertFourTranslations(input.translations);
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  const optionGroupBindings = await buildOptionGroupBindings(db, input.optionGroupIds);

  const product = await db.transaction(async (tx) => {
    const [productRow] = await tx
      .insert(productTable)
      .values({
        storeId: store.id,
        slug: input.slug,
        sku: input.sku,
        categoryId: input.categoryId,
        basePrice: input.basePrice,
        sortOrder: input.sortOrder ?? 0,
        isActive: false, // 見 INV-1/INV-2：建立當下沒有圖片，不能上架
      })
      .returning();

    const translations = input.translations.length
      ? await tx
          .insert(productTranslationTable)
          .values(translationRows(input.translations).map((t) => ({ ...t, productId: productRow.id })))
          .returning()
      : [];

    const optionGroups = optionGroupBindings.length
      ? await tx
          .insert(productOptionGroupTable)
          .values(optionGroupBindings.map((b) => ({ ...b, productId: productRow.id })))
          .returning()
      : [];

    return { ...productRow, translations, images: [], optionGroups };
  });
  await writeAuditLog({ actorId, action: "product.create", targetType: "Product", targetId: product.id, diff: input });
  return product;
}

/**
 * ProductOptionGroup.isRequired 預設值不應直接沿用 schema 的 default(true)——
 * 那是給沒有更好判斷依據時的保底值。這裡改用群組本身的 minSelect 判斷：
 * minSelect > 0（例如必選的 boxSize）才視為必填，minSelect = 0（例如選填的 addon）則否。
 * 後台目前沒有讓管理者在綁定當下覆寫這個值的 UI，先以此為合理預設。
 */
async function buildOptionGroupBindings(db: DbOrTx, optionGroupIds: string[]) {
  if (optionGroupIds.length === 0) return [];
  const groups = await db.query.optionGroup.findMany({
    where: inArray(optionGroupTable.id, optionGroupIds),
    columns: { id: true, minSelect: true },
  });
  const minSelectById = new Map(groups.map((g) => [g.id, g.minSelect]));
  return optionGroupIds.map((groupId, index) => ({
    groupId,
    sortOrder: index,
    isRequired: (minSelectById.get(groupId) ?? 0) > 0,
  }));
}

export async function updateProduct(
  id: string,
  input: {
    slug?: string;
    sku?: string | null;
    categoryId?: string | null;
    basePrice?: number;
    sortOrder?: number;
    isActive?: boolean;
    translations?: TranslationInput[];
    optionGroupIds?: string[];
    images?: ImageInput[];
  },
  actorId: string,
) {
  const db = await getDb();
  const existing = await db.query.product.findFirst({
    where: eq(productTable.id, id),
    with: { translations: true, images: true },
  });
  if (!existing) throw new NotFoundError("商品不存在");

  if (input.translations) assertFourTranslations(input.translations);

  if (input.isActive) {
    const translationCount = input.translations ? 4 : existing.translations.length;
    const images = input.images ?? existing.images;
    assertActivationInvariants(translationCount, images);
  }

  const optionGroupBindings = input.optionGroupIds
    ? await buildOptionGroupBindings(db, input.optionGroupIds)
    : undefined;

  const result = await db.transaction(async (tx) => {
    if (input.translations) {
      await tx.delete(productTranslationTable).where(eq(productTranslationTable.productId, id));
    }
    if (input.optionGroupIds) {
      await tx.delete(productOptionGroupTable).where(eq(productOptionGroupTable.productId, id));
    }
    if (input.images) {
      await tx.delete(productImageTable).where(eq(productImageTable.productId, id));
    }

    // 見 docs/DRIZZLE-MIGRATION-SPEC.md：只更新 translations/images/optionGroupIds、
    // 不帶其他欄位是合法的呼叫方式，Drizzle 的 `.set({})` 若全部欄位都是 undefined
    // 會直接拋錯，故只在真的有欄位要更新時才呼叫 `.update()`。注意 sku/categoryId
    // 允許顯式傳 `null`（清空該欄位），只有 `undefined` 才代表「不更動」，兩者不可混淆。
    const patch: Partial<typeof productTable.$inferInsert> = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.sku !== undefined) patch.sku = input.sku;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.basePrice !== undefined) patch.basePrice = input.basePrice;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const [productRow] =
      Object.keys(patch).length > 0
        ? await tx.update(productTable).set(patch).where(eq(productTable.id, id)).returning()
        : await tx.select().from(productTable).where(eq(productTable.id, id));

    const translations = input.translations
      ? await tx
          .insert(productTranslationTable)
          .values(translationRows(input.translations).map((t) => ({ ...t, productId: id })))
          .returning()
      : await tx.query.productTranslation.findMany({ where: eq(productTranslationTable.productId, id) });

    const optionGroups = optionGroupBindings
      ? optionGroupBindings.length
        ? await tx
            .insert(productOptionGroupTable)
            .values(optionGroupBindings.map((b) => ({ ...b, productId: id })))
            .returning()
        : []
      : await tx.query.productOptionGroup.findMany({ where: eq(productOptionGroupTable.productId, id) });

    const images = input.images
      ? input.images.length
        ? await tx
            .insert(productImageTable)
            .values(
              input.images.map((img, index) => ({
                productId: id,
                url: img.url,
                width: img.width,
                height: img.height,
                altText: img.altText,
                isPrimary: img.isPrimary ?? index === 0,
                sortOrder: img.sortOrder ?? index,
              })),
            )
            .returning()
        : []
      : await tx.query.productImage.findMany({ where: eq(productImageTable.productId, id) });

    return { ...productRow, translations, images, optionGroups };
  });
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "product.update", targetType: "Product", targetId: id, diff: input });
  return result;
}

export async function updateProductAvailability(
  id: string,
  input: { isActive?: boolean; isSoldOut?: boolean },
  actorId: string,
) {
  const db = await getDb();
  const existing = await db.query.product.findFirst({
    where: eq(productTable.id, id),
    with: { translations: true, images: true },
  });
  if (!existing) throw new NotFoundError("商品不存在");

  if (input.isActive) {
    assertActivationInvariants(existing.translations.length, existing.images);
  }

  // 見 docs/DRIZZLE-MIGRATION-SPEC.md：isActive/isSoldOut 都可能是 undefined（呼叫端
  // 只想切其中一個），Drizzle 的 `.set({})` 全部欄位都是 undefined 時會直接拋錯。
  const availabilityPatch: Partial<typeof productTable.$inferInsert> = {};
  if (input.isActive !== undefined) availabilityPatch.isActive = input.isActive;
  if (input.isSoldOut !== undefined) availabilityPatch.isSoldOut = input.isSoldOut;
  const [result] =
    Object.keys(availabilityPatch).length > 0
      ? await db.update(productTable).set(availabilityPatch).where(eq(productTable.id, id)).returning()
      : await db.select().from(productTable).where(eq(productTable.id, id));
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({
    actorId,
    action: "product.availability",
    targetType: "Product",
    targetId: id,
    diff: input,
  });
  return result;
}

export async function deleteProduct(id: string, actorId: string) {
  const db = await getDb();
  const existing = await db.query.product.findFirst({ where: eq(productTable.id, id) });
  if (!existing) throw new NotFoundError("商品不存在");
  // 見 SPEC.md INV-7：一律軟刪除
  await db.update(productTable).set({ deletedAt: new Date(), isActive: false }).where(eq(productTable.id, id));
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "product.delete", targetType: "Product", targetId: id });
}

export async function listMissingTranslations() {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  const products = await db.query.product.findMany({
    where: and(eq(productTable.storeId, store.id), isNull(productTable.deletedAt)),
    with: { translations: true },
  });

  return products
    .filter((p) => p.translations.length < 4)
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      missingLocales: LOCALES.filter(
        (l) => !p.translations.some((t) => t.locale === toDbLocale(l)),
      ),
    }));
}
