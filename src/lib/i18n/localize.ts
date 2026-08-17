import type { LocaleCode } from "@/db/schema";

/** 依 SPEC.md §4.3：商品內容缺譯時 fallback 至 zh-TW */
export function pickTranslation<T extends { locale: LocaleCode }>(
  translations: T[],
  dbLocale: LocaleCode,
): T | undefined {
  return (
    translations.find((t) => t.locale === dbLocale) ??
    translations.find((t) => t.locale === "ZH_TW")
  );
}

/** 見 SPEC.md §5.1 OrderItem.nameSnapshot：{ "ZH_TW": "...", "EN": "...", ... } */
export function toTranslationRecord(
  translations: { locale: LocaleCode; name: string }[],
): Record<LocaleCode, string> {
  return Object.fromEntries(translations.map((t) => [t.locale, t.name])) as Record<
    LocaleCode,
    string
  >;
}
