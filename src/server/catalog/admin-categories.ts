import { revalidateTag } from "next/cache";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { orThrow } from "@/db/helpers";
import {
  category as categoryTable,
  categoryTranslation as categoryTranslationTable,
  product as productTable,
} from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { writeAuditLog } from "@/server/admin/audit-log";

type CategoryTranslationInput = { locale: Locale; name: string };

function translationRows(translations: CategoryTranslationInput[]) {
  return translations.map((t) => ({
    locale: toDbLocale(t.locale),
    name: t.name,
  }));
}

export async function listCategoriesAdmin() {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());
  const categories = await db.query.category.findMany({
    where: eq(categoryTable.storeId, store.id),
    orderBy: [asc(categoryTable.sortOrder)],
    with: { translations: true },
  });

  const categoryIds = categories.map((c) => c.id);
  const counts = categoryIds.length
    ? await db
        .select({ categoryId: productTable.categoryId, count: sql<number>`count(*)::int` })
        .from(productTable)
        .where(inArray(productTable.categoryId, categoryIds))
        .groupBy(productTable.categoryId)
    : [];
  const countByCategory = new Map(counts.map((c) => [c.categoryId, c.count]));

  return categories.map((c) => ({ ...c, _count: { products: countByCategory.get(c.id) ?? 0 } }));
}

export async function createCategory(
  input: {
    slug: string;
    sortOrder?: number;
    translations: CategoryTranslationInput[];
  },
  actorId: string,
) {
  const db = await getDb();
  const store = orThrow(await db.query.store.findFirst());

  const category = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(categoryTable)
      .values({ storeId: store.id, slug: input.slug, sortOrder: input.sortOrder ?? 0 })
      .returning();
    const translations = input.translations.length
      ? await tx
          .insert(categoryTranslationTable)
          .values(translationRows(input.translations).map((t) => ({ ...t, categoryId: row.id })))
          .returning()
      : [];
    return { ...row, translations };
  });

  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "category.create", targetType: "Category", targetId: category.id, diff: input });
  return category;
}

export async function updateCategory(
  id: string,
  input: {
    slug?: string;
    sortOrder?: number;
    isActive?: boolean;
    translations?: CategoryTranslationInput[];
  },
  actorId: string,
) {
  const db = await getDb();
  const existing = await db.query.category.findFirst({ where: eq(categoryTable.id, id) });
  if (!existing) throw new NotFoundError("分類不存在");

  const category = await db.transaction(async (tx) => {
    if (input.translations) {
      await tx.delete(categoryTranslationTable).where(eq(categoryTranslationTable.categoryId, id));
    }

    // 見 docs/DRIZZLE-MIGRATION-SPEC.md：Prisma 的 `data: { a: undefined }` 視為
    // 「不更動這個欄位」，Drizzle 的 `.set({})` 若過濾掉 undefined 後變成空物件會
    // 直接拋錯（"No values to set"）——只更新 translations、不帶其他欄位是合法的
    // 呼叫方式（例如後台只改翻譯的表單），故只在真的有欄位要更新時才呼叫 `.update()`。
    const patch: Partial<typeof categoryTable.$inferInsert> = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    const [row] =
      Object.keys(patch).length > 0
        ? await tx.update(categoryTable).set(patch).where(eq(categoryTable.id, id)).returning()
        : await tx.select().from(categoryTable).where(eq(categoryTable.id, id));

    const translations = input.translations
      ? await tx
          .insert(categoryTranslationTable)
          .values(translationRows(input.translations).map((t) => ({ ...t, categoryId: id })))
          .returning()
      : await tx.query.categoryTranslation.findMany({ where: eq(categoryTranslationTable.categoryId, id) });

    return { ...row, translations };
  });

  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "category.update", targetType: "Category", targetId: id, diff: input });
  return category;
}

export async function deleteCategory(id: string, actorId: string) {
  const db = await getDb();
  const existing = await db.query.category.findFirst({ where: eq(categoryTable.id, id) });
  if (!existing) throw new NotFoundError("分類不存在");
  // 商品的 categoryId 為可選欄位，刪除分類前先解除關聯，避免外鍵限制擋下操作
  await db.transaction(async (tx) => {
    await tx.update(productTable).set({ categoryId: null }).where(eq(productTable.categoryId, id));
    await tx.delete(categoryTable).where(eq(categoryTable.id, id));
  });
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "category.delete", targetType: "Category", targetId: id });
}
