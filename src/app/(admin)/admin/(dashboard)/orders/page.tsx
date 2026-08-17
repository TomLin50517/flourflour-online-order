"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

type AdminOrder = {
  id: string;
  orderNo: string;
  status: "PAID" | "PREPARING" | "READY" | "COMPLETED";
  version: number;
  pickupNumber: string | null;
  placedAt: string;
  customerNote: string | null;
  items: { quantity: number; nameSnapshot: Record<string, string> }[];
};

const COLUMNS: { status: AdminOrder["status"]; title: string; next?: AdminOrder["status"] }[] = [
  { status: "PAID", title: "待製作", next: "PREPARING" },
  { status: "PREPARING", title: "製作中", next: "READY" },
  { status: "READY", title: "可取餐", next: "COMPLETED" },
  { status: "COMPLETED", title: "已完成" },
];

const NEXT_LABEL: Record<string, string> = {
  PREPARING: "開始製作",
  READY: "完成，可取餐",
  COMPLETED: "已取餐",
};

function playBeep() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = 880;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  } catch {
    // 忽略瀏覽器不支援 Web Audio 的情況
  }
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function readSoundPreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem("admin.orders.sound");
  return stored === null ? true : stored === "true";
}

export default function AdminOrdersPage() {
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference);
  const [pickupFilter, setPickupFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const knownIds = useRef<Set<string> | null>(null);

  const { data: orders = [], mutate } = useSWR<AdminOrder[]>(
    "/api/v1/admin/orders",
    fetcher,
    {
      refreshInterval: 10_000,
      onSuccess: (data) => {
        if (knownIds.current) {
          const newlyPaid = data.filter(
            (o) => o.status === "PAID" && !knownIds.current!.has(o.id),
          );
          if (newlyPaid.length > 0 && soundEnabled) playBeep();
        }
        knownIds.current = new Set(data.map((o) => o.id));
      },
    },
  );

  function toggleSound(value: boolean) {
    setSoundEnabled(value);
    window.localStorage.setItem("admin.orders.sound", String(value));
  }

  async function advance(order: AdminOrder, toStatus: AdminOrder["status"]) {
    setError(null);
    const res = await fetch(`/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toStatus, expectedVersion: order.version }),
    });
    if (res.status === 409) {
      setError("訂單已被他人更新，畫面將重新整理");
      await mutate();
      return;
    }
    if (!res.ok) {
      setError("操作失敗，請稍後再試");
      return;
    }
    await mutate();
  }

  const filtered = pickupFilter
    ? orders.filter((o) => o.pickupNumber?.includes(pickupFilter))
    : orders;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">訂單看板</h1>
        <div className="flex items-center gap-3 text-sm">
          <input
            placeholder="搜尋取餐號"
            value={pickupFilter}
            onChange={(e) => setPickupFilter(e.target.value)}
            className="rounded-md border px-2 py-1"
          />
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => toggleSound(e.target.checked)}
            />
            新單提示音
          </label>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {COLUMNS.map((column) => {
          const columnOrders = filtered.filter((o) => o.status === column.status);
          return (
            <div key={column.status} className="rounded-lg border bg-background">
              <div className="border-b px-3 py-2 text-sm font-semibold">
                {column.title}（{columnOrders.length}）
              </div>
              <div className="space-y-2 p-2">
                {columnOrders.map((order) => (
                  <div
                    key={order.id}
                    className={`rounded-md border p-3 text-sm ${
                      order.customerNote ? "border-amber-400 bg-amber-50" : ""
                    }`}
                  >
                    <div className="text-3xl font-bold">{order.pickupNumber ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      下單於 {new Date(order.placedAt).toLocaleTimeString("zh-TW")}（等待
                      {minutesSince(order.placedAt)} 分）
                    </div>
                    <ul className="mt-1 text-xs">
                      {order.items.map((item, i) => (
                        <li key={i}>
                          {item.nameSnapshot.ZH_TW} × {item.quantity}
                        </li>
                      ))}
                    </ul>
                    {order.customerNote && (
                      <p className="mt-1 text-xs font-medium text-amber-700">
                        備註：{order.customerNote}
                      </p>
                    )}
                    {column.next && (
                      <button
                        type="button"
                        onClick={() => advance(order, column.next!)}
                        className="mt-2 w-full rounded-md bg-primary py-1 text-xs font-medium text-primary-foreground"
                      >
                        {NEXT_LABEL[column.next]}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
