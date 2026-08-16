import { NextResponse } from "next/server";

// 見 SPEC.md §12.1：CSP、X-Content-Type-Options、Referrer-Policy 於 middleware 統一設定；
// 「全站 HTTPS；HSTS」另立一行，一併在這裡處理。
//
// CSP 對 script-src/style-src 使用 'unsafe-inline'：App Router 的 hydration/RSC
// 內嵌 script、以及本專案手刻圖表元件（TrendChart/TopProductsChart）用到的
// React inline style prop，都需要它；要收緊成 nonce-based CSP需要另外設計
// nonce 產生與透傳機制，列為未來加強項（見 docs/OPEN-QUESTIONS.md）。
const storageOrigin = (() => {
  try {
    return process.env.STORAGE_PUBLIC_BASE_URL ? new URL(process.env.STORAGE_PUBLIC_BASE_URL).origin : null;
  } catch {
    return null;
  }
})();

// React/Next.js 開發模式的 Fast Refresh 會用到 eval()（正式環境不會，React 官方文件本身也
// 這麼說明），故 'unsafe-eval' 只在非正式環境放行，避免正式環境的 CSP 被不必要地放寬。
const isProduction = process.env.NODE_ENV === "production";

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${storageOrigin ? ` ${storageOrigin}` : ""}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function applySecurityHeaders<T extends NextResponse>(response: T): T {
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  // 瀏覽器只會信任經 HTTPS 送出的 HSTS 標頭，本機 HTTP 開發環境送這個標頭無害。
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return response;
}
