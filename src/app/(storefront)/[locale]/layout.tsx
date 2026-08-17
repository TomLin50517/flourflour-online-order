import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { routing } from "@/i18n/routing";
import { getDb } from "@/db/client";
import "../../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// 見 CLAUDE.md／SPEC.md：菜單、店家資訊皆為即時資料，前台頁面本就不該被當成
// 靜態頁面預先產生。強制動態渲染，避免 `next build` 在建置階段（此時通常沒有
// 可連線的資料庫，例如 CI/CD 建置環境）嘗試查詢 Store 而直接讓整個建置失敗。
export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: LayoutProps<"/[locale]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "menu" });
  return { title: t("title") };
}

export default async function LocaleLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const db = await getDb();
  const store = await db.query.store.findFirst();

  return (
    <html lang={locale}>
      <body>
        {/* 見 docs/OPEN-QUESTIONS.md：移除 middleware 後，next-intl 自動偵測目前
            locale 的機制（原本部分依賴 middleware 設定的線索）不可靠，client
            端的 useRouter()/Link 等 navigation helper 會退回 defaultLocale，
            導致「加入購物車」等導航跳到錯誤語系。這裡的 `locale` 來自路由本身
            的 `params.locale`（Next.js 原生機制，不依賴 middleware），明確傳入
            避免依賴自動偵測。 */}
        <NextIntlClientProvider locale={locale}>
          <Header storeName={store?.name ?? ""} />
          {props.children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
