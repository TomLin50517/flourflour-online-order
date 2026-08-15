"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCart } from "@/lib/cart/cart-context";

type OrderResult = {
  orderNo: string;
  totalAmount: number;
  currency: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

export default function CheckoutPage() {
  const t = useTranslations("checkout");
  const tCart = useTranslations("cart");
  const locale = useLocale();
  const { lines, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        locale,
        items: lines,
        customer: { name: name || undefined, phone: phone || undefined },
        note: note || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "送出失敗");
      setSubmitting(false);
      return;
    }

    const order: OrderResult = await res.json();
    setResult(order);
    clear();
    setSubmitting(false);
  }

  if (result) {
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <h1 className="text-xl font-semibold">{t("orderCreated")}</h1>
        <p className="mt-2 text-2xl font-bold">{result.orderNo}</p>
        <p className="mt-4 text-sm text-muted-foreground">{t("paymentPending")}</p>
        <a href={`/${locale}`} className="mt-6 inline-block underline">
          {t("backToMenu")}
        </a>
      </main>
    );
  }

  if (lines.length === 0) {
    return (
      <main className="px-4 py-16 text-center text-muted-foreground">{tCart("empty")}</main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm">
          {t("name")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          {t("phone")}
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          {t("note")}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitting ? t("submitting") : t("submit")}
        </button>
      </form>
    </main>
  );
}
