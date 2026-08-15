import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { ProductDetailView } from "@/components/product/product-detail-view";
import { routing } from "@/i18n/routing";
import { NotFoundError } from "@/lib/errors";
import type { Locale } from "@/lib/i18n/locale-map";
import { getProduct } from "@/server/catalog/get-product";
import type { ProductDetail } from "@/server/catalog/types";

async function loadProduct(slug: string, locale: Locale): Promise<ProductDetail> {
  try {
    return await getProduct(slug, locale);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }
}

export default async function ProductPage(
  props: PageProps<"/[locale]/product/[slug]">,
) {
  const { locale, slug } = await props.params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const product = await loadProduct(slug, locale);
  return <ProductDetailView product={product} />;
}
