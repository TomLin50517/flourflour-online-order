"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { LOCALES, type Locale } from "@/lib/i18n/locale-map";

type Item = {
  id?: string;
  code: string;
  priceDelta: number;
  isDefault: boolean;
  translations: { locale: Locale; name: string }[];
};

type Group = {
  id: string;
  code: string;
  selectType: "SINGLE" | "MULTIPLE";
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  translations: { locale: string; name: string }[];
  items: {
    id: string;
    code: string;
    priceDelta: number;
    isDefault: boolean;
    translations: { locale: string; name: string }[];
  }[];
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

export default function OptionGroupsPage() {
  const { data: groups = [], mutate } = useSWR<Group[]>("/api/v1/admin/option-groups", fetcher);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [code, setCode] = useState("");
  const [selectType, setSelectType] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [minSelect, setMinSelect] = useState(1);
  const [maxSelect, setMaxSelect] = useState(1);
  const [translations, setTranslations] = useState(emptyTranslations());
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setEditingId("new");
    setCode("");
    setSelectType("SINGLE");
    setMinSelect(1);
    setMaxSelect(1);
    setTranslations(emptyTranslations());
    setItems([]);
    setError(null);
  }

  function startEdit(group: Group) {
    setEditingId(group.id);
    setCode(group.code);
    setSelectType(group.selectType);
    setMinSelect(group.minSelect);
    setMaxSelect(group.maxSelect);
    setTranslations(toEditableTranslations(group.translations));
    setItems(
      group.items.map((item) => ({
        id: item.id,
        code: item.code,
        priceDelta: item.priceDelta,
        isDefault: item.isDefault,
        translations: toEditableTranslations(item.translations),
      })),
    );
    setError(null);
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { code: "", priceDelta: 0, isDefault: false, translations: emptyTranslations() },
    ]);
  }

  async function save() {
    setError(null);
    const payload = {
      code,
      selectType,
      minSelect,
      maxSelect,
      translations,
      items: items.map((item, index) => ({
        code: item.code,
        priceDelta: item.priceDelta,
        sortOrder: index,
        isDefault: item.isDefault,
        translations: item.translations,
      })),
    };

    const res =
      editingId === "new"
        ? await fetch("/api/v1/admin/option-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/v1/admin/option-groups/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "儲存失敗");
      return;
    }

    setEditingId(null);
    await mutate();
  }

  async function remove(id: string) {
    if (!confirm("確定刪除此規格群組？")) return;
    await fetch(`/api/v1/admin/option-groups/${id}`, { method: "DELETE" });
    await mutate();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">規格管理</h1>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          新增規格群組
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ul className="space-y-2">
          {groups.map((group) => (
            <li key={group.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{group.code}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {group.selectType} · {group.minSelect}–{group.maxSelect}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => startEdit(group)} className="underline">
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(group.id)}
                    className="text-destructive underline"
                  >
                    刪除
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {group.items.map((i) => i.code).join(", ")}
              </p>
            </li>
          ))}
        </ul>

        {editingId && (
          <div className="space-y-3 rounded-md border p-4">
            <h2 className="font-medium">{editingId === "new" ? "新增規格群組" : "編輯規格群組"}</h2>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                代碼
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1 w-full rounded-md border px-2 py-1"
                />
              </label>
              <label className="text-sm">
                類型
                <select
                  value={selectType}
                  onChange={(e) => setSelectType(e.target.value as "SINGLE" | "MULTIPLE")}
                  className="mt-1 w-full rounded-md border px-2 py-1"
                >
                  <option value="SINGLE">單選 SINGLE</option>
                  <option value="MULTIPLE">複選 MULTIPLE</option>
                </select>
              </label>
              <label className="text-sm">
                最少選擇
                <input
                  type="number"
                  value={minSelect}
                  onChange={(e) => setMinSelect(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border px-2 py-1"
                />
              </label>
              <label className="text-sm">
                最多選擇
                <input
                  type="number"
                  value={maxSelect}
                  onChange={(e) => setMaxSelect(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border px-2 py-1"
                />
              </label>
            </div>

            <div>
              <p className="text-sm font-medium">群組名稱（四語系）</p>
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

            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">選項</p>
                <button type="button" onClick={addItem} className="text-xs underline">
                  + 新增選項
                </button>
              </div>
              {items.map((item, idx) => (
                <div key={idx} className="mt-2 space-y-1 rounded-md border p-2">
                  <div className="grid grid-cols-3 gap-1">
                    <input
                      placeholder="code"
                      value={item.code}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((p, pi) => (pi === idx ? { ...p, code: e.target.value } : p)),
                        )
                      }
                      className="rounded-md border px-2 py-1 text-xs"
                    />
                    <input
                      type="number"
                      placeholder="加價"
                      value={item.priceDelta}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((p, pi) =>
                            pi === idx ? { ...p, priceDelta: Number(e.target.value) } : p,
                          ),
                        )
                      }
                      className="rounded-md border px-2 py-1 text-xs"
                    />
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={item.isDefault}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, pi) =>
                              pi === idx ? { ...p, isDefault: e.target.checked } : p,
                            ),
                          )
                        }
                      />
                      預設
                    </label>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {item.translations.map((t, ti) => (
                      <input
                        key={t.locale}
                        placeholder={t.locale}
                        value={t.name}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, pi) =>
                              pi === idx
                                ? {
                                    ...p,
                                    translations: p.translations.map((pt, pti) =>
                                      pti === ti ? { ...pt, name: e.target.value } : pt,
                                    ),
                                  }
                                : p,
                            ),
                          )
                        }
                        className="rounded-md border px-2 py-1 text-xs"
                      />
                    ))}
                  </div>
                </div>
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
