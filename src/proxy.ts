import { randomUUID } from "node:crypto";
import createIntlMiddleware from "next-intl/middleware";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { routing } from "./i18n/routing";
import { applySecurityHeaders } from "./lib/security-headers";

const handleIntl = createIntlMiddleware(routing);

// 見 docs/OPEN-QUESTIONS.md：middleware 只需要「解讀既有 session cookie」，不需要
// 完整版 ./auth.ts 那個帶 bcrypt／Prisma 的 Credentials provider——用 authConfig
// 另外建一個輕量 instance，讓 middleware 的 bundle 保持 edge-safe。
const { auth } = NextAuth(authConfig);

// 見 SPEC.md §4.2：/admin/* 固定 zh-TW，不走語系協商，改由 session 保護。
// 見 SPEC.md §12.1：安全標頭統一於 middleware 設定，含 /api/* 在內，故 matcher
// 不再排除 api（僅排除 _next/_vercel/靜態檔），下面針對 /api 另外提早 return，
// 避免它被 next-intl 的語系協商邏輯誤判為頁面路徑。
// 見 SPEC.md §12.3：requestId 由 middleware 產生並貫穿。/api、/admin 分支會把
// requestId 一併寫回請求標頭，讓 route handler 可用 `request.headers.get("x-request-id")`
// 取得；next-intl 分支的回應是由它自己內部建構，這裡不強行改寫其請求物件，
// 僅保證回應標頭一定帶得到（供瀏覽器端/支援排查關聯用）。
export default auth((request) => {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const { pathname } = request.nextUrl;

  function decorate<T extends NextResponse>(response: T): T {
    response.headers.set("x-request-id", requestId);
    return applySecurityHeaders(response);
  }

  function nextWithRequestId(): NextResponse {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);
    return decorate(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  if (pathname.startsWith("/api")) {
    return nextWithRequestId();
  }

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") {
      return nextWithRequestId();
    }
    if (!request.auth) {
      return decorate(NextResponse.redirect(new URL("/admin/login", request.nextUrl)));
    }
    return nextWithRequestId();
  }

  // 見 SPEC.md §7.4：/dev/mock-pay 是開發用頁面，不走語系協商（本身以 NODE_ENV 自我限制註冊）。
  if (pathname.startsWith("/dev")) {
    return nextWithRequestId();
  }

  return decorate(handleIntl(request));
});

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
