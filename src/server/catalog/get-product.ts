import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { pickTranslation } from "@/lib/i18n/localize";
import type { ProductDetail } from "./types";

export async function getProduct(
  slug: string,
  locale: Locale,
): Promise<ProductDetail> {
  const dbLocale = toDbLocale(locale);

  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    include: {
      translations: true,
      images: { orderBy: { sortOrder: "asc" } },
      optionGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          group: {
            include: {
              translations: true,
              items: {
                where: { isActive: true },
                orderBy: { sortOrder: "asc" },
                include: { translations: true },
              },
            },
          },
        },
      },
    },
  });

  if (!product) throw new NotFoundError("Product not found");

  const translation = pickTranslation(product.translations, dbLocale);

  return {
    id: product.id,
    slug: product.slug,
    name: translation?.name ?? "",
    description: translation?.description ?? null,
    basePrice: product.basePrice,
    isSoldOut: product.isSoldOut,
    images: product.images.map((image) => ({
      url: image.url,
      width: image.width,
      height: image.height,
      alt: image.altText ?? translation?.name ?? "",
    })),
    optionGroups: product.optionGroups.map((binding) => ({
      id: binding.group.id,
      name: pickTranslation(binding.group.translations, dbLocale)?.name ?? "",
      selectType: binding.group.selectType,
      minSelect: binding.group.minSelect,
      maxSelect: binding.group.maxSelect,
      isRequired: binding.isRequired,
      items: binding.group.items.map((item) => ({
        id: item.id,
        code: item.code,
        name: pickTranslation(item.translations, dbLocale)?.name ?? "",
        priceDelta: item.priceDelta,
        isDefault: item.isDefault,
      })),
    })),
  };
}
