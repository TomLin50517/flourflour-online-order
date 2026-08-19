"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, formatApiErrorMessage } from "@/lib/fetcher";
import { LOCALES, type Locale } from "@/lib/i18n/locale-map";

type Category = {
  id: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  translations: { locale: string; name: string }[];
  _count: { products: number };
};

const DB_TO_LOCALE: Record<string, Locale> = { ZH_TW: "zh-TW", EN: "en", JA: "ja", KO: "ko" };

function emptyTranslations(): { locale: Locale; name: string }[] {
  return LOCALES.map((locale) => ({ locale, name: "" }));
}

function toEditableTranslations(rows: { locale: string; name: string }[]) {
  return LOCALES.map((locale) => ({
    locale,
    name: rows.find((r) => DB_TO_LOCALE[r.locale] === locale)?.name ?? "",
  }));
}

export default function CategoriesPage() {
  const { data: categories = [], mutate } = useSWR<Category[]>("/api/v1/admin/categories", fetcher);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [slug, setSlug] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [translations, setTranslations] = useState(emptyTranslations());
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setEditingId("new");
    setSlug("");
    setSortOrder(0);
    setIsActive(true);
    setTranslations(emptyTranslations());
    setError(null);
  }

  function startEdit(category: Category) {
    setEditingId(category.id);
    setSlug(category.slug);
    setSortOrder(category.sortOrder);
    setIsActive(category.isActive);
    setTranslations(toEditableTranslations(category.translations));
    setError(null);
  }

  async function save() {
    setError(null);
    const payload = { slug, sortOrder, isActive, translations };

    const res =
      editingId === "new"
        ? await fetch("/api/v1/admin/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/v1/admin/categories/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(formatApiErrorMessage(body, "儲存失敗"));
      return;
    }

    setEditingId(null);
    await mutate();
  }

  async function remove(id: string) {
    if (!confirm("確定刪除此分類？分類下的商品會變成未分類。")) return;
    await fetch(`/api/v1/admin/categories/${id}`, { method: "DELETE" });
    await mutate();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">分類管理</h1>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          新增分類
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ul className="space-y-2">
          {categories.map((category) => (
            <li key={category.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">
                    {category.translations.find((t) => t.locale === "ZH_TW")?.name ?? category.slug}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {category.slug} · 排序 {category.sortOrder} · {category._count.products} 項商品
                    {!category.isActive && " · 已停用"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => startEdit(category)} className="underline">
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(category.id)}
                    className="text-destructive underline"
                  >
                    刪除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {editingId && (
          <div className="space-y-3 rounded-md border p-4">
            <h2 className="font-medium">{editingId === "new" ? "新增分類" : "編輯分類"}</h2>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                Slug
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-1 w-full rounded-md border px-2 py-1"
                />
              </label>
              <label className="text-sm">
                排序（數字越小越前面）
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                啟用（顯示在選單上）
              </label>
            </div>

            <div>
              <p className="text-sm font-medium">分類名稱（四語系）</p>
              {translations.map((t, i) => (
                <input
                  key={t.locale}
                  placeholder={t.locale}
                  value={t.name}
                  onChange={(e) =>
                    setTranslations((prev) =>
                      prev.map((p, pi) => (pi === i ? { ...p, name: e.target.value } : p)),
                    )
                  }
                  className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                儲存
              </button>
              <button type="button" onClick={() => setEditingId(null)} className="text-sm underline">
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
