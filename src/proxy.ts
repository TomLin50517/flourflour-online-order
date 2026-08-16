import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { routing } from "./i18n/routing";

const handleIntl = createIntlMiddleware(routing);

// 見 SPEC.md §4.2：/admin/* 固定 zh-TW，不走語系協商，改由 session 保護。
export default auth((request) => {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") {
      return NextResponse.next();
    }
    if (!request.auth) {
      return NextResponse.redirect(new URL("/admin/login", request.nextUrl));
    }
    return NextResponse.next();
  }

  // 見 SPEC.md §7.4：/dev/mock-pay 是開發用頁面，不走語系協商（本身以 NODE_ENV 自我限制註冊）。
  if (pathname.startsWith("/dev")) {
    return NextResponse.next();
  }

  return handleIntl(request);
});

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
