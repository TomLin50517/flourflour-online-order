import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale-map";
import { localeQuerySchema } from "@/schemas/catalog";
import { getMenu } from "@/server/catalog/get-menu";

const getCachedMenu = unstable_cache(getMenu, ["catalog-menu"], {
  tags: ["menu"],
  revalidate: 60,
});

export async function GET(request: NextRequest) {
  try {
    const { locale } = localeQuerySchema.parse({
      locale: request.nextUrl.searchParams.get("locale") ?? undefined,
    });
    const menu = await getCachedMenu(locale ?? DEFAULT_LOCALE);
    return NextResponse.json(menu);
  } catch (error) {
    return toErrorResponse(error);
  }
}
