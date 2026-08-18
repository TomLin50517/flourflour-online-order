"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter } from "@/i18n/navigation";
import { useCart } from "@/lib/cart/cart-context";
import { calcLineTotal, calcUnitPrice } from "@/lib/money";
import type { ProductDetail, ProductOptionGroup } from "@/server/catalog/types";

function groupBounds(group: ProductOptionGroup) {
  return {
    min: group.isRequired ? Math.max(group.minSelect, 1) : 0,
    max: group.maxSelect,
  };
}

function initialSelection(group: ProductOptionGroup): string[] {
  return group.items.filter((item) => item.isDefault).map((item) => item.id);
}

export function ProductDetailView({ product }: { product: ProductDetail }) {
  const t = useTranslations("product");
  const tMenu = useTranslations("menu");
  const router = useRouter();
  const { addLine } = useCart();

  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(product.optionGroups.map((g) => [g.id, initialSelection(g)])),
  );
  const [quantity, setQuantity] = useState(1);

  function selectSingle(group: ProductOptionGroup, itemId: string) {
    setSelected((prev) => ({ ...prev, [group.id]: [itemId] }));
  }

  function toggleMultiple(group: ProductOptionGroup, itemId: string) {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      const { max } = groupBounds(group);
      if (current.includes(itemId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== itemId) };
      }
      if (current.length >= max) return prev;
      return { ...prev, [group.id]: [...current, itemId] };
    });
  }

  const selectedItems = useMemo(
    () =>
      product.optionGroups.flatMap((group) =>
        (selected[group.id] ?? [])
          .map((id) => group.items.find((item) => item.id === id))
          .filter((item): item is NonNullable<typeof item> => item != null),
      ),
    [product.optionGroups, selected],
  );

  const unitPrice = calcUnitPrice(
    product.basePrice,
    selectedItems.map((item) => item.priceDelta),
  );
  const total = calcLineTotal(unitPrice, quantity);

  const invalidGroups = product.optionGroups.filter((group) => {
    const { min, max } = groupBounds(group);
    const count = (selected[group.id] ?? []).length;
    return count < min || count > max;
  });
  const canAddToCart = invalidGroups.length === 0 && !product.isSoldOut;

  function handleAddToCart() {
    if (!canAddToCart) return;
    addLine({
      productId: product.id,
      quantity,
      optionItemIds: selectedItems.map((item) => item.id),
    });
    router.push("/cart");
  }

  return (
    <div className="pb-28">
      {product.images.length > 0 && (
        <div className="relative aspect-square w-full bg-muted">
          <Image
            src={product.images[0].url}
            alt={product.images[0].alt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        </div>
      )}

      <div className="space-y-6 px-4 py-4">
        <div>
          <h1 className="text-xl font-semibold">{product.name}</h1>
          {product.description && (
            <p className="mt-1 text-sm text-muted-foreground">{product.description}</p>
          )}
          <p className="mt-2 text-lg font-semibold">NT${product.basePrice}</p>
        </div>

        {product.optionGroups.map((group) => {
          const { min } = groupBounds(group);
          const isInvalid = invalidGroups.includes(group);
          return (
            <fieldset key={group.id} className="space-y-2">
              <legend className="text-sm font-medium">
                {group.name}
                {min > 0 && (
                  <span className="ml-2 text-xs text-destructive">{t("required")}</span>
                )}
              </legend>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => {
                  const isSelected = (selected[group.id] ?? []).includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${
                        isSelected ? "border-primary bg-primary/10" : "border-input"
                      }`}
                    >
                      <input
                        type={group.selectType === "SINGLE" ? "radio" : "checkbox"}
                        name={group.id}
                        className="sr-only"
                        checked={isSelected}
                        onChange={() =>
                          group.selectType === "SINGLE"
                            ? selectSingle(group, item.id)
                            : toggleMultiple(group, item.id)
                        }
                      />
                      {item.name}
                      {item.priceDelta !== 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {item.priceDelta > 0 ? `+NT$${item.priceDelta}` : `-NT$${Math.abs(item.priceDelta)}`}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {isInvalid && (
                <p className="text-xs text-destructive">{t("required")}</p>
              )}
            </fieldset>
          );
        })}

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{t("quantity")}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="size-8 rounded-md border"
              aria-label="-"
            >
              −
            </button>
            <span className="w-6 text-center">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              className="size-8 rounded-md border"
              aria-label="+"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* 見 (storefront)/[locale]/layout.tsx：body 有 max-w-md mx-auto 限制寬度，
          但 fixed 定位是相對整個視窗、不受父層寬度限制，這裡比照加上同樣的
          寬度與置中，才能跟上方內容欄對齊，不會桌面版時比內容還寬。 */}
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md items-center justify-between border-t bg-background px-4 py-3">
        <span className="text-lg font-semibold">NT${total}</span>
        <button
          type="button"
          disabled={!canAddToCart}
          onClick={handleAddToCart}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {product.isSoldOut ? tMenu("soldOut") : t("addToCart")}
        </button>
      </div>
    </div>
  );
}
