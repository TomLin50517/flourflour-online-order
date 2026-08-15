"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALES, type Locale } from "@/lib/i18n/locale-map";

const LOCALE_LABELS: Record<Locale, string> = {
  "zh-TW": "繁中",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value as Locale;
    router.replace(
      // @ts-expect-error -- pathname is dynamically typed per-route by next-intl
      { pathname, params },
      { locale: nextLocale },
    );
  }

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={handleChange}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
