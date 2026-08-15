import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { routing } from "@/i18n/routing";
import { prisma } from "@/lib/db";
import "./globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

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
