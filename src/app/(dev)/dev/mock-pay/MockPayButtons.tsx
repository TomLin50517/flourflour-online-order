"use client";

import { useState } from "react";

export function MockPayButtons({ orderNo, paymentId }: { orderNo: string; paymentId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function trigger(outcome: "SUCCESS" | "FAILED") {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/dev/mock-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo, paymentId, outcome }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setStatus(`觸發失敗：${body?.error?.message ?? res.status}`);
      } else {
        setStatus(
          outcome === "SUCCESS"
            ? "已模擬付款成功，webhook 已送出，請回訂單頁查看取餐號碼。"
            : "已模擬付款失敗，webhook 已送出。",
        );
      }
    } catch {
      setStatus("觸發失敗，請確認伺服器是否可自我連線（APP_BASE_URL 設定）。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        disabled={loading}
        onClick={() => trigger("SUCCESS")}
        className="w-full rounded-md bg-green-600 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        模擬付款成功
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => trigger("FAILED")}
        className="w-full rounded-md bg-red-600 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        模擬付款失敗
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() =>
          setStatus("模擬逾時：不會送出任何 webhook。請直接離開此頁面，訂單將於到期時間後由逾時 job 自動取消。")
        }
        className="w-full rounded-md border py-3 text-sm font-medium disabled:opacity-50"
      >
        模擬逾時（不觸發 webhook）
      </button>
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
    </div>
  );
}
