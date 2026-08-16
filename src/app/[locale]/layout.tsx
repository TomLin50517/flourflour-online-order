import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { routing } from "@/i18n/routing";
import { getDb } from "@/lib/db";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// 見 CLAUDE.md／SPEC.md：菜單、店家資訊皆為即時資料，前台頁面本就不該被當成
// 靜態頁面預先產生。強制動態渲染，避免 `next build` 在建置階段（此時通常沒有
// 可連線的資料庫，例如 CI/CD 建置環境）嘗試執行 prisma.store.findFirst() 而
// 直接讓整個建置失敗。
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

  const prisma = await getDb();
  const store = await prisma.store.findFirst();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <Header storeName={store?.name ?? ""} />
          {props.children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
