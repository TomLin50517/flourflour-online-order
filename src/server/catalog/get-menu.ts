import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { toDbLocale, type Locale } from "@/lib/i18n/locale-map";
import { pickTranslation } from "@/lib/i18n/localize";
import type { Menu } from "./types";

export async function getMenu(locale: Locale): Promise<Menu> {
  const prisma = await getDb();
  const dbLocale = toDbLocale(locale);

  const store = await prisma.store.findFirst();
  if (!store) throw new NotFoundError("Store not found");

  const categories = await prisma.category.findMany({
    where: { storeId: store.id, isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      translations: true,
      products: {
        where: { isActive: true, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          translations: true,
          images: { where: { isPrimary: true }, take: 1 },
          optionGroups: { select: { groupId: true }, take: 1 },
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
          };
        }),
      };
    }),
  };
}
