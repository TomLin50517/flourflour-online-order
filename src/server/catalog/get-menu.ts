import { getDb } from "@/db/client";
import { NotFoundError } from "@/lib/errors";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { pickTranslation } from "@/lib/i18n/localize";
import type { Menu } from "./types";

export async function getMenu(locale: Locale): Promise<Menu> {
  const db = await getDb();
  const dbLocale = toDbLocale(locale);

  const store = await db.query.store.findFirst();
  if (!store) throw new NotFoundError("Store not found");

  const categories = await db.query.category.findMany({
    where: (c, { and, eq }) => and(eq(c.storeId, store.id), eq(c.isActive, true)),
    orderBy: (c, { asc }) => asc(c.sortOrder),
    with: {
      translations: true,
      products: {
        where: (p, { and, eq, isNull }) => and(eq(p.isActive, true), isNull(p.deletedAt)),
        orderBy: (p, { asc }) => asc(p.sortOrder),
        with: {
          translations: true,
          images: { where: (img, { eq }) => eq(img.isPrimary, true), limit: 1 },
          optionGroups: { columns: { groupId: true }, limit: 1 },
        },
      },
    },
  });

  return {
    store: { name: store.name, isOpen: store.isOpen, currency: store.currency },
    categories: categories.map((category) => {
      const categoryName = pickTranslation(category.translations, dbLocale)?.name ?? "";
      return {
        id: category.id,
        slug: category.slug,
        name: categoryName,
        products: category.products.map((product) => {
          const translation = pickTranslation(product.translations, dbLocale);
          const image = product.images[0];
          return {
            id: product.id,
            slug: product.slug,
            name: translation?.name ?? "",
            description: translation?.description ?? null,
            basePrice: product.basePrice,
            primaryImage: image
              ? {
                  url: image.url,
                  width: image.width,
                  height: image.height,
                  alt: image.altText ?? translation?.name ?? "",
                }
              : null,
            isSoldOut: product.isSoldOut,
            hasOptions: product.optionGroups.length > 0,
            containsAlcohol: product.containsAlcohol,
          };
        }),
      };
    }),
  };
}
