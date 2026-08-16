"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { TopProductsChart } from "./TopProductsChart";
import { TrendChart } from "./TrendChart";

type Summary = {
  from: string;
  to: string;
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  refundAmount: number;
  topProducts: { productId: string; productNameZh: string; netQuantity: number; netAmount: number }[];
  dailyTrend: { businessDate: string; orderCount: number; revenue: number }[];
};

type SalesRow = {
  productId: string;
  productNameZh: string;
  quantitySold: number;
  grossAmount: number;
  refundedQty: number;
  refundedAmount: number;
  netQuantity: number;
  netAmount: number;
  sharePercent: number;
};

type SortKey = "quantitySold" | "grossAmount" | "refundedQty" | "netQuantity" | "netAmount";

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  {
    label: "今日",
    range: () => {
      const t = toIso(new Date());
      return { from: t, to: t };
    },
  },
  {
    label: "昨日",
    range: () => {
      const t = toIso(addDays(new Date(), -1));
      return { from: t, to: t };
    },
  },
  {
    label: "近 7 日",
    range: () => {
      const to = new Date();
      return { from: toIso(addDays(to, -6)), to: toIso(to) };
    },
  },
  {
    label: "本月",
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toIso(from), to: toIso(now) };
    },
  },
];

export default function StatsPage() {
  // 預設區間（近 7 日）取決於瀏覽器當下的本地時間，SSR 當下的伺服器時間不一定
  // 相同（時區或跨午夜的邊界都可能不同），若直接當成 useState 初始值會在首次
  // hydrate 時造成 SSR/CSR 內容不一致而觸發 hydration 錯誤，故改在掛載後才用
  // useEffect（僅於瀏覽器執行）決定預設值。
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("netQuantity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    // 見上方註解：這裡的 setState 是「掛載後才能得知的瀏覽器本地日期」，
    // 不是可以在 render 階段算出來的衍生狀態，是 react-hooks/set-state-in-effect
    // 這條規則刻意允許的例外用法（React 官方文件本身也用這個模式避免 hydration
    // mismatch），故針對這兩行關閉規則。
    const initial = PRESETS[2].range(); // 近 7 日
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrom(initial.from);
    setTo(initial.to);
  }, []);

  const { data: summary } = useSWR<Summary>(
    from && to ? `/api/v1/admin/stats/summary?from=${from}&to=${to}` : null,
    fetcher,
  );
  const { data: report } = useSWR<{ from: string; to: string; items: SalesRow[] }>(
    from && to ? `/api/v1/admin/stats/daily-product-sales?from=${from}&to=${to}` : null,
    fetcher,
  );

  const items = useMemo(() => {
    const rows = report?.items ?? [];
    return [...rows].sort((a, b) => (a[sortKey] - b[sortKey]) * (sortDir === "asc" ? 1 : -1));
  }, [report, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const currency = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    minimumFractionDigits: 0,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">銷售統計</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const r = preset.range();
                setFrom(r.from);
                setTo(r.to);
              }}
              className="rounded-md border px-2 py-1 hover:bg-muted"
            >
              {preset.label}
            </button>
          ))}
          <input
            type="date"
            value={from ?? ""}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border px-2 py-1"
          />
          <span className="text-muted-foreground">至</span>
          <input
            type="date"
            value={to ?? ""}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border px-2 py-1"
          />
          <a
            href={from && to ? `/api/v1/admin/stats/daily-product-sales?from=${from}&to=${to}&format=csv` : undefined}
            aria-disabled={!(from && to)}
            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            匯出 CSV
          </a>
        </div>
      </div>

      <p className="mb-6 text-xs text-muted-foreground">
        統計口徑（見 SPEC.md §11）：歸屬日期採「營業日」（依付款時間換算，非日曆日、非下單時間）；已付款訂單（含之後才發生的退款）計入銷售數量與銷售金額；未付款、已取消訂單不計入；退款一律歸屬於原始付款當日，而非退款當日；表格預設依「淨數量」（銷售數量－退款數量）降冪排序。
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="總營收" value={summary ? currency.format(summary.revenue) : "…"} />
        <KpiCard label="訂單數" value={summary ? String(summary.orderCount) : "…"} />
        <KpiCard label="平均客單價" value={summary ? currency.format(summary.avgOrderValue) : "…"} />
        <KpiCard label="退款金額" value={summary ? currency.format(summary.refundAmount) : "…"} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-background p-4">
          <h2 className="mb-2 text-sm font-semibold">每日訂單數與營收</h2>
          <TrendChart data={summary?.dailyTrend ?? []} />
        </div>
        <div className="rounded-lg border bg-background p-4">
          <h2 className="mb-2 text-sm font-semibold">熱銷 Top 10（依淨數量）</h2>
          <TopProductsChart data={summary?.topProducts ?? []} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">商品</th>
              <SortableHeader
                label="銷售數量"
                sortKey="quantitySold"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableHeader
                label="銷售金額"
                sortKey="grossAmount"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableHeader
                label="退款數量"
                sortKey="refundedQty"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableHeader
                label="淨數量"
                sortKey="netQuantity"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableHeader
                label="淨金額"
                sortKey="netAmount"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <th className="p-2">佔比</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  此區間尚無銷售資料
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.productId} className="border-b">
                  <td className="p-2">{item.productNameZh}</td>
                  <td className="p-2">{item.quantitySold}</td>
                  <td className="p-2">{currency.format(item.grossAmount)}</td>
                  <td className="p-2">{item.refundedQty}</td>
                  <td className="p-2 font-medium">{item.netQuantity}</td>
                  <td className="p-2 font-medium">{currency.format(item.netAmount)}</td>
                  <td className="p-2">{item.sharePercent}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th className="cursor-pointer p-2 select-none" onClick={() => onClick(sortKey)}>
      {label}
      {active ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
}
