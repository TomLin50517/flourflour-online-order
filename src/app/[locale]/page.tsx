import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { routing } from "@/i18n/routing";
import { toDbLocale } from "@/lib/i18n/locale-map";

export default async function MenuPage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "menu" });
  const dbLocale = toDbLocale(locale);

  const store = await prisma.store.findFirst();
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      translations: true,
      products: {
        where: { isActive: true, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: { translations: true },
      },
    },
  });

  function localized(translations: { locale: string; name: string }[]) {
    return (
      translations.find((tr) => tr.locale === dbLocale)?.name ??
      translations.find((tr) => tr.locale === "ZH_TW")?.name ??
      ""
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>{store?.name}</h1>
      <h2>{t("title")}</h2>
      {categories.map((category) => (
        <section key={category.id}>
          <h3>{localized(category.translations)}</h3>
          <ul>
            {category.products.map((product) => (
              <li key={product.id}>
                {localized(product.translations)} — NT${product.basePrice}
                {product.isSoldOut ? ` (${t("soldOut")})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
