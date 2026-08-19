import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product/product-card";
import { routing } from "@/i18n/routing";
import { getMenu } from "@/server/catalog/get-menu";

export default async function MenuPage(props: PageProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "menu" });
  const menu = await getMenu(locale);
  const hasAnyProduct = menu.categories.some((c) => c.products.length > 0);

  return (
    <main className="pb-16">
      {hasAnyProduct ? (
        <>
          <nav className="sticky top-[3.25rem] z-[5] flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur">
            {menu.categories
              .filter((c) => c.products.length > 0)
              .map((category) => (
                <a
                  key={category.id}
                  href={`#${category.slug}`}
                  className="shrink-0 rounded-full border px-3 py-1 text-sm"
                >
                  {category.name}
                </a>
              ))}
          </nav>

          {menu.categories
            .filter((c) => c.products.length > 0)
            .map((category) => (
              <section
                key={category.id}
                id={category.slug}
                className="scroll-mt-28 px-4 pt-6"
              >
                <h2 className="mb-3 text-lg font-semibold">{category.name}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {category.products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            ))}
        </>
      ) : (
        <p className="px-4 py-16 text-center text-muted-foreground">
          {t("empty")}
        </p>
      )}
    </main>
  );
}
