import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "開發工具",
};

export default function DevRootLayout(props: LayoutProps<"/dev">) {
  return (
    <html lang="zh-TW">
      <body>{props.children}</body>
    </html>
  );
}
