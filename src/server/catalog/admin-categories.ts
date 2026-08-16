import { revalidateTag } from "next/cache";
import { getDb } from "@/lib/db";
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
  const prisma = await getDb();
  const store = await prisma.store.findFirstOrThrow();
  return prisma.category.findMany({
    where: { storeId: store.id },
    orderBy: { sortOrder: "asc" },
    include: { translations: true, _count: { select: { products: true } } },
  });
}

export async function createCategory(
  input: {
    slug: string;
    sortOrder?: number;
    translations: CategoryTranslationInput[];
  },
  actorId: string,
) {
  const prisma = await getDb();
  const store = await prisma.store.findFirstOrThrow();
  const category = await prisma.category.create({
    data: {
      storeId: store.id,
      slug: input.slug,
      sortOrder: input.sortOrder ?? 0,
      translations: { create: translationRows(input.translations) },
    },
    include: { translations: true },
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
  const prisma = await getDb();
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("分類不存在");

  const category = await prisma.$transaction(async (tx) => {
    if (input.translations) {
      await tx.categoryTranslation.deleteMany({ where: { categoryId: id } });
    }
    return tx.category.update({
      where: { id },
      data: {
        slug: input.slug,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        translations: input.translations
          ? { create: translationRows(input.translations) }
          : undefined,
      },
      include: { translations: true },
    });
  });
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "category.update", targetType: "Category", targetId: id, diff: input });
  return category;
}

export async function deleteCategory(id: string, actorId: string) {
  const prisma = await getDb();
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("分類不存在");
  // 商品的 categoryId 為可選欄位，刪除分類前先解除關聯，避免外鍵限制擋下操作
  await prisma.$transaction([
    prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
    prisma.category.delete({ where: { id } }),
  ]);
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "category.delete", targetType: "Category", targetId: id });
}
