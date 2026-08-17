import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n/locale-map";

const LOCALE_LIST: string[] = [...LOCALES];

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * 見 SPEC.md §4.2、docs/OPEN-QUESTIONS.md：原本由 next-intl middleware 處理的
 * 根路徑語言協商，改在這裡自己做——手動切換過的語系 cookie（NEXT_LOCALE，見
 * src/i18n/routing.ts 的 localeCookie 設定）優先權高於 Accept-Language；協商演算法
 * 直接複用 next-intl 內部本來就在用的 negotiator + @formatjs/intl-localematcher，
 * 不自己發明簡化版邏輯，確保跟先前 middleware 版本行為一致。
 */
export default async function RootPage() {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  if (cookieLocale && isLocale(cookieLocale)) {
    redirect(`/${cookieLocale}`);
  }

  const headerStore = await headers();
  const negotiator = new Negotiator({
    headers: { "accept-language": headerStore.get("accept-language") ?? "" },
  });
  const matched = match(negotiator.languages(), LOCALE_LIST, DEFAULT_LOCALE);
  redirect(`/${matched}`);
}
