import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale-map";
import { localeQuerySchema, productSlugParamsSchema } from "@/schemas/catalog";
import { getProduct } from "@/server/catalog/get-product";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/v1/products/[slug]">,
) {
  try {
    const { slug } = productSlugParamsSchema.parse(await context.params);
    const { locale } = localeQuerySchema.parse({
      locale: request.nextUrl.searchParams.get("locale") ?? undefined,
    });
    const product = await getProduct(slug, locale ?? DEFAULT_LOCALE);
    return NextResponse.json(product);
  } catch (error) {
    return toErrorResponse(error);
  }
}
