import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { getClientIp } from "@/lib/client-ip";
import { getDb } from "@/db/client";
import { adminUser } from "@/db/schema";
import { clearLoginFailures, isLockedOut, recordLoginFailure } from "@/lib/login-guard";
import { checkRateLimit } from "@/lib/rate-limit";

// 見 docs/OPEN-QUESTIONS.md：先前為了讓 middleware（src/proxy.ts）保持 edge-safe，
// 曾把設定拆成 auth.config.ts + auth.ts 兩個檔案。後來證實 Next.js 16 的 proxy.ts
// 架構性地強制 Node.js runtime，跟拆不拆分無關（已用對照實驗驗證），故改為徹底
// 移除 proxy.ts、把登入檢查搬到 app/admin/(dashboard)/layout.tsx，這個檔案不再
// 需要給 middleware 用的輕量版本，合併回單一檔案。
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Cloudflare Workers（跟其他 serverless/edge 平台一樣）需要明確信任 Request 的
  // Host header，否則 Auth.js 會拋 UntrustedHost 錯誤（見
  // https://errors.authjs.dev#untrustedhost）。NEXTAUTH_URL 已固定指向正式網域，
  // 故信任 Host header 不會被用來偽造跳轉目標。
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const ip = getClientIp(request);

        // 見 SPEC.md §12.1：/admin/login 每 IP 5 次/分。
        if (!checkRateLimit(`login:${ip}`, 5, 60_000)) return null;

        // 見 SPEC.md §10.1：失敗 5 次鎖定 15 分鐘（以 IP + email 計數）。
        if (isLockedOut(ip, email)) return null;

        const db = await getDb();
        const user = await db.query.adminUser.findFirst({ where: eq(adminUser.email, email) });
        if (!user || !user.isActive) {
          recordLoginFailure(ip, email);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          recordLoginFailure(ip, email);
          return null;
        }

        clearLoginFailures(ip, email);

        await db.update(adminUser).set({ lastLoginAt: new Date() }).where(eq(adminUser.id, user.id));

        return { id: user.id, email: user.email, name: user.displayName, role: user.role };
      },
    }),
  ],
});
