"use client";

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart/cart-context";

type OrderResult = {
  orderNo: string;
  accessToken: string;
  totalAmount: number;
  currency: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

type CreateChargeResult =
  | { mode: "REDIRECT"; paymentId: string; providerRef?: string; redirectUrl: string }
  | { mode: "FORM_POST"; paymentId: string; providerRef?: string; action: string; fields: Record<string, string> }
  | {
      mode: "SDK_TOKEN";
      paymentId: string;
      providerRef?: string;
      clientToken: string;
      sdkParams: Record<string, unknown>;
    };

// TEMP(pre-launch testing)：金流廠商尚未串接（見 docs/OPEN-QUESTIONS.md「正式站
// PAYMENT_PROVIDER=mock」條目），正式站上導向付款頁一律 404。在真正的廠商串接
// 完成前，先讓使用者測試「瀏覽 → 加入購物車 → 結帳 → 送出訂單」這段流程，建單
// 成功後改顯示提示對話框、不呼叫 startPayment()。廠商串接完成後應移除這個開關，
// 讓流程直接呼叫 startPayment()。
const PAUSE_BEFORE_PAYMENT_FOR_TESTING = true;

function submitFormPost(action: string, fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  for (const [key, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export default function CheckoutPage() {
  const t = useTranslations("checkout");
  const tCart = useTranslations("cart");
  const locale = useLocale();
  const router = useRouter();
  const { lines, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payingState, setPayingState] = useState<"idle" | "paying" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [showTestPauseDialog, setShowTestPauseDialog] = useState(false);

  const startPayment = useCallback(
    async (orderNo: string, accessToken: string) => {
      setPayingState("paying");
      setError(null);
      try {
        const res = await fetch(`/api/v1/orders/${orderNo}/payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Order-Token": accessToken,
          },
          body: JSON.stringify({ returnPath: `/${locale}/order/${orderNo}` }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? t("paymentFailed"));
          setPayingState("failed");
          return;
        }

        const result: CreateChargeResult = await res.json();
        // 見 SPEC.md §9.6：accessToken 存於 sessionStorage，訂單頁靠它查單。
        sessionStorage.setItem(`order.${orderNo}.token`, accessToken);

        if (result.mode === "REDIRECT") {
          window.location.assign(result.redirectUrl);
          return;
        }
        if (result.mode === "FORM_POST") {
          submitFormPost(result.action, result.fields);
          return;
        }
        // SDK_TOKEN（如 TapPay Fields）：待廠商 SDK 串接，見 SPEC.md §9.5 TODO(VENDOR-API)。
        // 先導向訂單頁，顧客可在該頁看到「等待付款」並手動重試。
        router.push(`/${locale}/order/${orderNo}`);
      } catch {
        setError(t("paymentFailed"));
        setPayingState("failed");
      }
    },
    [locale, router, t],
  );

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

    const created: OrderResult = await res.json();
    setOrder(created);
    clear();
    setSubmitting(false);
    if (PAUSE_BEFORE_PAYMENT_FOR_TESTING) {
      setShowTestPauseDialog(true);
      return;
    }
    await startPayment(created.orderNo, created.accessToken);
  }

  if (order) {
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <h1 className="text-xl font-semibold">{t("orderCreated")}</h1>
        <p className="mt-2 text-2xl font-bold">{order.orderNo}</p>
        {payingState === "paying" && (
          <p className="mt-4 text-sm text-muted-foreground">{t("redirectingToPayment")}</p>
        )}
        {payingState === "failed" && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-destructive">{error ?? t("paymentFailed")}</p>
            <button
              type="button"
              onClick={() => startPayment(order.orderNo, order.accessToken)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              {t("payNow")}
            </button>
          </div>
        )}
        <a href={`/${locale}`} className="mt-6 inline-block underline">
          {t("backToMenu")}
        </a>

        {showTestPauseDialog && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          >
            <div className="w-full max-w-sm rounded-lg bg-background p-6 text-center shadow-lg">
              <p className="text-sm text-foreground">{t("testPauseMessage")}</p>
              <button
                type="button"
                onClick={() => router.push(`/${locale}`)}
                className="mt-4 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground"
              >
                {t("testPauseConfirm")}
              </button>
            </div>
          </div>
        )}
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
