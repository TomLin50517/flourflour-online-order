import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as rootParamLocale } from "next/root-params";
import { routing } from "./routing";

// 見 docs/OPEN-QUESTIONS.md：移除 middleware 後，`getRequestConfig` 原本的
// `requestLocale` 參數（官方文件證實：本來就是靠 middleware 判斷路由匹配到的
// `[locale]` 區段、寫成一個線索傳過來）失去依據，會 fallback 錯誤的語系。改用
// Next.js 16.3+ 的 `next/root-params`——直接從 `app/[locale]/...` 這個動態路由
// 區段本身讀值，不依賴 middleware，是 next-intl 官方目前建議的做法。
export default getRequestConfig(async () => {
  const requested = await rootParamLocale();
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
