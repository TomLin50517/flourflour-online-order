import { getDb } from "@/db/client";
import { NotFoundError } from "@/lib/errors";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { pickTranslation } from "@/lib/i18n/localize";
import type { ProductDetail } from "./types";

export async function getProduct(
  slug: string,
  locale: Locale,
): Promise<ProductDetail> {
  const db = await getDb();
  const dbLocale = toDbLocale(locale);

  const product = await db.query.product.findFirst({
    where: (p, { and, eq, isNull }) => and(eq(p.slug, slug), eq(p.isActive, true), isNull(p.deletedAt)),
    with: {
      translations: true,
      images: { orderBy: (img, { asc }) => asc(img.sortOrder) },
      optionGroups: {
        orderBy: (pog, { asc }) => asc(pog.sortOrder),
        with: {
          group: {
            with: {
              translations: true,
              items: {
                where: (item, { eq }) => eq(item.isActive, true),
                orderBy: (item, { asc }) => asc(item.sortOrder),
                with: { translations: true },
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
