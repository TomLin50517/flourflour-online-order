// 見 docs/OPEN-QUESTIONS.md：`/` 這個路由只做語系協商後 redirect（見同目錄
// page.tsx），永遠不會真的把這份 html 送到瀏覽器；但 App Router 仍要求每個
// route group 各自有一個提供 <html>/<body> 的 root layout 才能通過建置期的
// 結構驗證（`next build --webpack` 會擋，`next build`/Turbopack 目前不會）。
export default function RootRedirectLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
