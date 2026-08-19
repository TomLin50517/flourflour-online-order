"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher, formatApiErrorMessage } from "@/lib/fetcher";

type ProductRow = {
  id: string;
  slug: string;
  basePrice: number;
  sortOrder: number;
  isActive: boolean;
  isSoldOut: boolean;
  translations: { locale: string }[];
  images: { url: string }[];
  category: { translations: { locale: string; name: string }[] } | null;
};

export default function ProductsListPage() {
  const { data, isLoading, mutate } = useSWR<{ products: ProductRow[] }>(
    "/api/v1/admin/products",
    fetcher,
  );
  const products = data?.products ?? [];

  async function toggle(id: string, field: "isActive" | "isSoldOut", value: boolean) {
    const res = await fetch(`/api/v1/admin/products/${id}/availability`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(formatApiErrorMessage(body, "操作失敗"));
    }
    await mutate();
  }

  async function updateSortOrder(id: string, sortOrder: number) {
    const res = await fetch(`/api/v1/admin/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(formatApiErrorMessage(body, "操作失敗"));
    }
    await mutate();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">商品管理</h1>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          新增商品
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中…</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">圖片</th>
              <th className="p-2">Slug</th>
              <th className="p-2">分類</th>
              <th className="p-2">價格</th>
              <th className="p-2">排序</th>
              <th className="p-2">翻譯完整度</th>
              <th className="p-2">上架</th>
              <th className="p-2">售完</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="p-2">
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin 內部工具，縮圖不需要 next/image 最佳化
                    <img src={p.images[0].url} alt="" className="size-10 rounded object-cover" />
                  ) : (
                    <div className="size-10 rounded bg-muted" />
                  )}
                </td>
                <td className="p-2">{p.slug}</td>
                <td className="p-2">
                  {p.category?.translations.find((t) => t.locale === "ZH_TW")?.name ?? "—"}
                </td>
                <td className="p-2">NT${p.basePrice}</td>
                <td className="p-2">
                  <input
                    type="number"
                    key={p.sortOrder}
                    defaultValue={p.sortOrder}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value !== p.sortOrder) updateSortOrder(p.id, value);
                    }}
                    className="w-16 rounded-md border px-2 py-1"
                  />
                </td>
                <td className="p-2">
                  {p.translations.length === 4 ? (
                    "4/4"
                  ) : (
                    <span className="text-destructive">⚠ {p.translations.length}/4</span>
                  )}
                </td>
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={p.isActive}
                    onChange={(e) => toggle(p.id, "isActive", e.target.checked)}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={p.isSoldOut}
                    onChange={(e) => toggle(p.id, "isSoldOut", e.target.checked)}
                  />
                </td>
                <td className="p-2">
                  <Link href={`/admin/products/${p.id}`} className="underline">
                    編輯
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
