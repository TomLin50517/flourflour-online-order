import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "後台管理",
};

export default function AdminRootLayout(props: LayoutProps<"/admin">) {
  return (
    <html lang="zh-TW">
      <body>{props.children}</body>
    </html>
  );
}
