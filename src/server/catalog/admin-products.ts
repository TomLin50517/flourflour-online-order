import { revalidateTag } from "next/cache";
import { LOCALES } from "@/lib/i18n/locale-map";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { prisma } from "@/lib/db";
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
  const store = await prisma.store.findFirstOrThrow();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;

  const where = {
    storeId: store.id,
    deletedAt: null,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(filters.keyword
      ? { translations: { some: { name: { contains: filters.keyword, mode: "insensitive" as const } } } }
      : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { sortOrder: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        translations: true,
        images: { where: { isPrimary: true }, take: 1 },
        category: { include: { translations: true } },
      },
    }),
  ]);

  return { total, page, pageSize, products };
}

export async function getProductAdmin(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      translations: true,
      images: { orderBy: { sortOrder: "asc" } },
      optionGroups: { include: { group: { include: { translations: true } } } },
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
  const store = await prisma.store.findFirstOrThrow();
  const optionGroupBindings = await buildOptionGroupBindings(input.optionGroupIds);

  const product = await prisma.product.create({
    data: {
      storeId: store.id,
      slug: input.slug,
      sku: input.sku,
      categoryId: input.categoryId,
      basePrice: input.basePrice,
      sortOrder: input.sortOrder ?? 0,
      isActive: false, // 見 INV-1/INV-2：建立當下沒有圖片，不能上架
      translations: { create: translationRows(input.translations) },
      optionGroups: { create: optionGroupBindings },
    },
    include: { translations: true, images: true, optionGroups: true },
  });
  await writeAuditLog({ actorId, action: "product.create", targetType: "Product", targetId: product.id, diff: input });
  return product;
}

/**
 * ProductOptionGroup.isRequired 預設值不應直接沿用 Prisma schema 的 @default(true)——
 * 那是給沒有更好判斷依據時的保底值。這裡改用群組本身的 minSelect 判斷：
 * minSelect > 0（例如必選的 boxSize）才視為必填，minSelect = 0（例如選填的 addon）則否。
 * 後台目前沒有讓管理者在綁定當下覆寫這個值的 UI，先以此為合理預設。
 */
async function buildOptionGroupBindings(optionGroupIds: string[]) {
  if (optionGroupIds.length === 0) return [];
  const groups = await prisma.optionGroup.findMany({
    where: { id: { in: optionGroupIds } },
    select: { id: true, minSelect: true },
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
  const existing = await prisma.product.findUnique({
    where: { id },
    include: { translations: true, images: true },
  });
  if (!existing) throw new NotFoundError("商品不存在");

  if (input.translations) assertFourTranslations(input.translations);

  if (input.isActive) {
    const translationCount = input.translations ? 4 : existing.translations.length;
    const images = input.images ?? existing.images;
    assertActivationInvariants(translationCount, images);
  }

  const optionGroupBindings = input.optionGroupIds
    ? await buildOptionGroupBindings(input.optionGroupIds)
    : undefined;

  const result = await prisma.$transaction(async (tx) => {
    if (input.translations) {
      await tx.productTranslation.deleteMany({ where: { productId: id } });
    }
    if (input.optionGroupIds) {
      await tx.productOptionGroup.deleteMany({ where: { productId: id } });
    }
    if (input.images) {
      await tx.productImage.deleteMany({ where: { productId: id } });
    }

    return tx.product.update({
      where: { id },
      data: {
        slug: input.slug,
        sku: input.sku,
        categoryId: input.categoryId,
        basePrice: input.basePrice,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        translations: input.translations
          ? { create: translationRows(input.translations) }
          : undefined,
        optionGroups: optionGroupBindings ? { create: optionGroupBindings } : undefined,
        images: input.images
          ? {
              create: input.images.map((img, index) => ({
                url: img.url,
                width: img.width,
                height: img.height,
                altText: img.altText,
                isPrimary: img.isPrimary ?? index === 0,
                sortOrder: img.sortOrder ?? index,
              })),
            }
          : undefined,
      },
      include: { translations: true, images: true, optionGroups: true },
    });
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
  const existing = await prisma.product.findUnique({
    where: { id },
    include: { translations: true, images: true },
  });
  if (!existing) throw new NotFoundError("商品不存在");

  if (input.isActive) {
    assertActivationInvariants(existing.translations.length, existing.images);
  }

  const result = await prisma.product.update({
    where: { id },
    data: { isActive: input.isActive, isSoldOut: input.isSoldOut },
  });
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
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("商品不存在");
  // 見 SPEC.md INV-7：一律軟刪除
  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  revalidateTag("menu", { expire: 0 });
  await writeAuditLog({ actorId, action: "product.delete", targetType: "Product", targetId: id });
}

export async function listMissingTranslations() {
  const store = await prisma.store.findFirstOrThrow();
  const products = await prisma.product.findMany({
    where: { storeId: store.id, deletedAt: null },
    include: { translations: true },
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
