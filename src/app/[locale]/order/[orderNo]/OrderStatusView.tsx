"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";

type OrderDetail = {
  orderNo: string;
  status: OrderStatus;
  pickupNumber: string | null;
  totalAmount: number;
  placedAt: string;
  paidAt: string | null;
  readyAt: string | null;
  expiresAt: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number; options: string[] }[];
};

const TERMINAL_STATUSES: OrderStatus[] = ["COMPLETED", "CANCELLED", "REFUNDED"];
const PROGRESS_STEPS: OrderStatus[] = ["PAID", "PREPARING", "READY", "COMPLETED"];

// 見 SPEC.md §9.6：輪詢間隔依狀態而定，終態停止輪詢。
function pollIntervalFor(status: OrderStatus): number | null {
  if (status === "READY") return 15000;
  if (status === "PENDING_PAYMENT" || status === "PAID" || status === "PREPARING") return 5000;
  return null;
}

export function OrderStatusView({
  orderNo,
  tokenFromQuery,
}: {
  orderNo: string;
  tokenFromQuery?: string;
}) {
  const t = useTranslations("order");
  const locale = useLocale();

  // 見 SPEC.md §9.6：accessToken 存於 sessionStorage，亦支援 ?t= 帶入（分享／重開）。
  // 用 lazy initializer 而非 effect 讀取，避免掛載後才 setState 造成多餘的重渲染。
  const [token] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return tokenFromQuery ?? sessionStorage.getItem(`order.${orderNo}.token`);
  });
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const notifiedReady = useRef(false);

  useEffect(() => {
    if (token) {
      sessionStorage.setItem(`order.${orderNo}.token`, token);
    }
  }, [orderNo, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const res = await fetch(`/api/v1/orders/${orderNo}`, {
          headers: { "X-Order-Token": token as string },
        });
        if (!res.ok) {
          if (!cancelled) setError(t("loadError"));
          return;
        }
        const data: OrderDetail = await res.json();
        if (cancelled) return;
        setOrder(data);
        setError(null);

        const interval = pollIntervalFor(data.status);
        if (interval) {
          timer = setTimeout(load, interval);
        }
      } catch {
        if (!cancelled) setError(t("loadError"));
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderNo, token, t]);

  useEffect(() => {
    if (order?.status !== "PENDING_PAYMENT") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [order?.status]);

  useEffect(() => {
    if (order?.status === "READY" && !notifiedReady.current) {
      notifiedReady.current = true;
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [order?.status]);

  const countdown = useMemo(() => {
    if (!order) return null;
    const remainingMs = new Date(order.expiresAt).getTime() - now;
    if (remainingMs <= 0) return null;
    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [order, now]);

  if (!token || (error && !order)) {
    return <main className="px-4 py-16 text-center text-destructive">{error ?? t("loadError")}</main>;
  }

  if (!order) {
    return <main className="px-4 py-16 text-center text-muted-foreground">…</main>;
  }

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: 0,
  });

  return (
    <main className={`mx-auto max-w-md px-4 py-8 ${order.status === "READY" ? "bg-yellow-50" : ""}`}>
      <h1 className="text-center text-lg font-semibold">{t("title")}</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">{order.orderNo}</p>

      {order.status === "PENDING_PAYMENT" && (
        <div className="mt-8 space-y-3 text-center">
          <p className="text-base">{t("waitingPayment")}</p>
          {countdown ? (
            <p className="text-3xl font-bold tabular-nums">{countdown}</p>
          ) : (
            <p className="text-destructive">{t("expired")}</p>
          )}
          <a
            href={`/${locale}/checkout`}
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("retryPayment")}
          </a>
        </div>
      )}

      {order.status !== "PENDING_PAYMENT" && order.pickupNumber && (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">{t("pickupNumber")}</p>
          <p className="text-[96px] leading-none font-black">{order.pickupNumber}</p>
        </div>
      )}

      {PROGRESS_STEPS.includes(order.status) && (
        <ol className="mt-8 flex justify-between text-xs">
          {PROGRESS_STEPS.map((step) => {
            const reached = PROGRESS_STEPS.indexOf(order.status) >= PROGRESS_STEPS.indexOf(step);
            return (
              <li key={step} className={reached ? "text-primary font-semibold" : "text-muted-foreground"}>
                {t(`status.${step}`)}
              </li>
            );
          })}
        </ol>
      )}

      {order.status === "READY" && (
        <p className="mt-6 text-center text-xl font-bold">{t("readyNotice")}</p>
      )}

      {TERMINAL_STATUSES.includes(order.status) && (
        <p className="mt-8 text-center text-base font-medium">{t(`status.${order.status}`)}</p>
      )}

      <p className="mt-10 text-center text-xs text-muted-foreground">{t("bookmarkHint")}</p>

      <section className="mt-8 border-t pt-4">
        <h2 className="text-sm font-semibold">{t("itemsTitle")}</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between">
              <span>
                {item.name}
                {item.options.length > 0 ? `（${item.options.join("、")}）` : ""} × {item.quantity}
              </span>
              <span>{currencyFormatter.format(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t pt-2 text-sm font-semibold">
          <span>{t("total")}</span>
          <span>{currencyFormatter.format(order.totalAmount)}</span>
        </div>
      </section>
    </main>
  );
}
