"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { useCart } from "@/lib/cart/cart-context";
import type { MenuProduct } from "@/server/catalog/types";

export function ProductCard({ product }: { product: MenuProduct }) {
  const t = useTranslations("menu");
  const tProduct = useTranslations("product");
  const { addLine } = useCart();

  function handleQuickAdd(event: React.MouseEvent) {
    event.preventDefault();
    addLine({ productId: product.id, quantity: 1, optionItemIds: [] });
  }

  const card = (
    <div className="flex flex-col overflow-hidden rounded-lg border">
      <div className="relative aspect-square w-full bg-muted">
        {product.primaryImage && (
          <Image
            src={product.primaryImage.url}
            alt={product.primaryImage.alt}
            fill
            loading="lazy"
            sizes="(max-width: 640px) 50vw, 25vw"
            className={`object-cover ${product.isSoldOut ? "grayscale" : ""}`}
          />
        )}
        {product.isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded bg-background px-2 py-1 text-sm font-medium">
              {t("soldOut")}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="text-sm font-medium">{product.name}</h3>
        {product.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {product.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-sm font-semibold">NT${product.basePrice}</span>
          {!product.isSoldOut && !product.hasOptions && (
            <button
              type="button"
              onClick={handleQuickAdd}
              aria-label={tProduct("addToCart")}
              className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (product.isSoldOut) {
    return <div aria-disabled className="pointer-events-none opacity-80">{card}</div>;
  }

  if (product.hasOptions) {
    return <Link href={`/product/${product.slug}`}>{card}</Link>;
  }

  return card;
}
