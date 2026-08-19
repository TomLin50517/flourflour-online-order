"use client";

import { ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { useCart } from "@/lib/cart/cart-context";

export function Header({ storeName }: { storeName: string }) {
  const t = useTranslations("cart");
  const { itemCount } = useCart();

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
      <Link href="/" className="shrink-0">
        <Image src="/images/logo.png" alt={storeName} width={480} height={128} priority className="h-14 w-auto" />
      </Link>
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
        <Link
          href="/cart"
          aria-label={t("title")}
          className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-accent"
        >
          <ShoppingCart className="size-5" />
          {itemCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {itemCount > 99 ? "99+" : itemCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
