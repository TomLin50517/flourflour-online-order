import { LocaleCode } from "@/generated/prisma/enums";

export const LOCALES = ["zh-TW", "en", "ja", "ko"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-TW";

const LOCALE_TO_DB: Record<Locale, LocaleCode> = {
  "zh-TW": LocaleCode.ZH_TW,
  en: LocaleCode.EN,
  ja: LocaleCode.JA,
  ko: LocaleCode.KO,
};

const DB_TO_LOCALE: Record<LocaleCode, Locale> = {
  ZH_TW: "zh-TW",
  EN: "en",
  JA: "ja",
  KO: "ko",
};

export function toDbLocale(locale: Locale): LocaleCode {
  return LOCALE_TO_DB[locale];
}

export function fromDbLocale(locale: LocaleCode): Locale {
  return DB_TO_LOCALE[locale];
}
