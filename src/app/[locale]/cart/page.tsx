"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useCart } from "@/lib/cart/cart-context";
import { calcLineTotal, calcSubtotal, calcUnitPrice } from "@/lib/money";
import type { Menu, ProductDetail } from "@/server/catalog/types";

type ResolvedLine = {
  index: number;
  productId: string;
  quantity: number;
  optionItemIds: string[];
  name: string;
  imageUrl: string | null;
  optionNames: string[];
  unitPrice: number;
  lineTotal: number;
  available: boolean;
};

export default function CartPage() {
  const t = useTranslations("cart");
  const tMenu = useTranslations("menu");
  const tCommon = useTranslations("common");
  const tError = useTranslations("error");
  const tCheckout = useTranslations("checkout");
  const locale = useLocale();
  const { lines, updateQuantity, removeLine } = useCart();

  const [menu, setMenu] = useState<Menu | null>(null);
  const [productDetails, setProductDetails] = useState<Record<string, ProductDetail>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/v1/menu?locale=${locale}`);
      const menuData: Menu = await res.json();
      if (cancelled) return;
      setMenu(menuData);

      const productsById = new Map(
        menuData.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)),
      );

      const slugsNeeded = [
        ...new Set(
          lines
            .filter((l) => l.optionItemIds.length > 0)
            .map((l) => productsById.get(l.productId)?.slug)
            .filter((slug): slug is string => Boolean(slug)),
        ),
      ];

      const details = await Promise.all(
        slugsNeeded.map(async (slug) => {
          const r = await fetch(`/api/v1/products/${slug}?locale=${locale}`);
          const data: ProductDetail = await r.json();
          return [slug, data] as const;
        }),
      );
      if (cancelled) return;
      setProductDetails(Object.fromEntries(details));
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [locale, lines]);

  const resolvedLines = useMemo<ResolvedLine[]>(() => {
    if (!menu) return [];
    const productsById = new Map(
      menu.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)),
    );

    return lines.map((line, index) => {
      const product = productsById.get(line.productId);
      const detail = product ? productDetails[product.slug] : undefined;

      const selectedOptionItems = (detail?.optionGroups ?? [])
        .flatMap((g) => g.items)
        .filter((item) => line.optionItemIds.includes(item.id));

      const unitPrice = calcUnitPrice(
        product?.basePrice ?? 0,
        selectedOptionItems.map((i) => i.priceDelta),
      );

      return {
        index,
        productId: line.productId,
        quantity: line.quantity,
        optionItemIds: line.optionItemIds,
        name: product?.name ?? "",
        imageUrl: product?.primaryImage?.url ?? null,
        optionNames: selectedOptionItems.map((i) => i.name),
        unitPrice,
        lineTotal: calcLineTotal(unitPrice, line.quantity),
        available: Boolean(product) && !product?.isSoldOut,
      };
    });
  }, [menu, lines, productDetails]);

  const hasUnavailable = resolvedLines.some((l) => !l.available);
  const subtotal = calcSubtotal(resolvedLines.map((l) => l.lineTotal));

  if (loading) {
    return <main className="px-4 py-16 text-center text-muted-foreground">{tCommon("loading")}</main>;
  }

  if (lines.length === 0) {
    return (
      <main className="px-4 py-16 text-center text-muted-foreground">
        {t("empty")}
      </main>
    );
  }

  return (
    <main className="px-4 pb-24 pt-4">
      <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>

      <ul className="space-y-4">
        {resolvedLines.map((line) => (
          <li key={line.index} className="flex gap-3 border-b pb-4">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
              {line.imageUrl && (
                <Image src={line.imageUrl} alt={line.name} fill className="object-cover" />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium">{line.name}</span>
              {line.optionNames.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {line.optionNames.join(" / ")}
                </span>
              )}
              {!line.available && (
                <span className="text-xs font-medium text-destructive">
                  {tMenu("soldOut")}
                </span>
              )}
              <div className="mt-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.index, line.quantity - 1)}
                    className="size-7 rounded-md border"
                    aria-label="-"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.index, Math.min(99, line.quantity + 1))}
                    className="size-7 rounded-md border"
                    aria-label="+"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm font-semibold">NT${line.lineTotal}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeLine(line.index)}
              className="self-start text-xs text-muted-foreground underline"
            >
              {tCommon("cancel")}
            </button>
          </li>
        ))}
      </ul>

      {hasUnavailable && (
        <p className="mt-4 text-sm text-destructive">{tError("outOfStock")}</p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 space-y-2 border-t bg-background px-4 py-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t("subtotal")}</span>
          <span>NT${subtotal}</span>
        </div>
        <a
          href={hasUnavailable ? undefined : `/${locale}/checkout`}
          aria-disabled={hasUnavailable}
          className={`block w-full rounded-md py-2 text-center text-sm font-medium ${
            hasUnavailable
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {tCheckout("title")}
        </a>
      </div>
    </main>
  );
}
