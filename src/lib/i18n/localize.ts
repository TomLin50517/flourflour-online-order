import type { LocaleCode } from "@/generated/prisma/enums";

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
