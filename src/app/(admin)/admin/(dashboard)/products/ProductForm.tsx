"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCALES, type Locale } from "@/lib/i18n/locale-map";

type Translation = { locale: Locale; name: string; description: string };
type ImageRow = { url: string; width: number; height: number; isPrimary: boolean };
type CategoryOption = { id: string; name: string };
type OptionGroupOption = { id: string; code: string };

const DB_TO_LOCALE: Record<string, Locale> = { ZH_TW: "zh-TW", EN: "en", JA: "ja", KO: "ko" };
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function emptyTranslations(): Translation[] {
  return LOCALES.map((locale) => ({ locale, name: "", description: "" }));
}

export function ProductForm({
  mode,
  productId,
  categories,
  optionGroups,
  initial,
}: {
  mode: "create" | "edit";
  productId?: string;
  categories: CategoryOption[];
  optionGroups: OptionGroupOption[];
  initial?: {
    slug: string;
    sku: string;
    categoryId: string;
    basePrice: number;
    translations: { locale: string; name: string; description: string | null }[];
    images: ImageRow[];
    optionGroupIds: string[];
  };
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [basePrice, setBasePrice] = useState(initial?.basePrice ?? 0);
  const [translations, setTranslations] = useState<Translation[]>(
    initial
      ? LOCALES.map((locale) => {
          const found = initial.translations.find((t) => DB_TO_LOCALE[t.locale] === locale);
          return { locale, name: found?.name ?? "", description: found?.description ?? "" };
        })
      : emptyTranslations(),
  );
  const [images, setImages] = useState<ImageRow[]>(initial?.images ?? []);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(initial?.optionGroupIds ?? []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("圖片大小不可超過 5MB");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("僅支援 jpeg/png/webp 格式");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // 見 docs/OPEN-QUESTIONS.md：檔案直接上傳到伺服器，由伺服器驗證內容
      // （magic bytes）並轉檔為 webp，不再走 presigned URL 直傳 S3。
      const body = new FormData();
      body.append("file", file);

      const res = await fetch("/api/v1/admin/uploads", { method: "POST", body });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        throw new Error(errorBody?.error?.message ?? "上傳失敗");
      }
      const { url, width, height } = await res.json();

      setImages((prev) => [...prev, { url, width, height, isPrimary: prev.length === 0 }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  }

  function setPrimary(index: number) {
    setImages((prev) => prev.map((img, i) => ({ ...img, isPrimary: i === index })));
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length > 0 && !next.some((img) => img.isPrimary)) next[0].isPrimary = true;
      return next;
    });
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }

  async function handleSave(activate: boolean) {
    setError(null);
    const payload = {
      slug,
      sku: sku || undefined,
      categoryId: categoryId || undefined,
      basePrice,
      translations: translations.map((t) => ({
        locale: t.locale,
        name: t.name,
        description: t.description || undefined,
      })),
      optionGroupIds: selectedGroupIds,
      ...(mode === "edit" ? { images, isActive: activate } : {}),
    };

    const res =
      mode === "create"
        ? await fetch("/api/v1/admin/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/v1/admin/products/${productId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "儲存失敗");
      return;
    }

    router.push("/admin/products");
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-2 rounded-md border p-4">
        <h2 className="font-medium">基本資料</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>
            Slug
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1"
            />
          </label>
          <label>
            SKU
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1"
            />
          </label>
          <label>
            分類
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1"
            >
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            價格 (NT$)
            <input
              type="number"
              value={basePrice}
              onChange={(e) => setBasePrice(Number(e.target.value))}
              className="mt-1 w-full rounded-md border px-2 py-1"
            />
          </label>
        </div>
      </section>

      <section className="space-y-2 rounded-md border p-4">
        <h2 className="font-medium">四語系內容</h2>
        {translations.map((t, i) => (
          <div key={t.locale} className="space-y-1 border-b pb-2 text-sm last:border-b-0">
            <p className="text-xs font-medium text-muted-foreground">{t.locale}</p>
            <input
              placeholder="名稱"
              value={t.name}
              onChange={(e) =>
                setTranslations((prev) =>
                  prev.map((p, pi) => (pi === i ? { ...p, name: e.target.value } : p)),
                )
              }
              className="w-full rounded-md border px-2 py-1"
            />
            <textarea
              placeholder="簡介"
              value={t.description}
              onChange={(e) =>
                setTranslations((prev) =>
                  prev.map((p, pi) => (pi === i ? { ...p, description: e.target.value } : p)),
                )
              }
              className="w-full rounded-md border px-2 py-1"
            />
          </div>
        ))}
      </section>

      {mode === "edit" && (
        <section className="space-y-2 rounded-md border p-4">
          <h2 className="font-medium">圖片</h2>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={img.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin 內部工具，上傳預覽不需要 next/image 最佳化 */}
                <img
                  src={img.url}
                  alt=""
                  className={`size-20 rounded object-cover ${img.isPrimary ? "ring-2 ring-primary" : ""}`}
                />
                <div className="mt-1 flex gap-1 text-[10px]">
                  <button type="button" onClick={() => setPrimary(i)} className="underline">
                    {img.isPrimary ? "主圖" : "設為主圖"}
                  </button>
                  <button type="button" onClick={() => removeImage(i)} className="text-destructive underline">
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} />
          {uploading && <p className="text-xs text-muted-foreground">上傳中…</p>}
        </section>
      )}

      <section className="space-y-2 rounded-md border p-4">
        <h2 className="font-medium">規格群組</h2>
        {optionGroups.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedGroupIds.includes(g.id)}
              onChange={() => toggleGroup(g.id)}
            />
            {g.code}
          </label>
        ))}
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleSave(false)}
          className="rounded-md border px-4 py-2 text-sm"
        >
          儲存草稿
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={() => handleSave(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            儲存並上架
          </button>
        )}
      </div>
    </div>
  );
}
