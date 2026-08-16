import type { NextAuthConfig } from "next-auth";

// 見 docs/OPEN-QUESTIONS.md：Auth.js 官方建議的 edge-safe 拆分。這個檔案只放
// middleware 真的需要的設定（session 策略、callbacks），刻意不含 Credentials
// provider 的 authorize()（那裡面用了 bcrypt／Prisma，兩者都不是 edge-safe）。
// middleware（src/proxy.ts）只需要「解讀既有 session cookie 判斷是否已登入」，
// 不需要「驗證帳密」這個動作本身，所以 providers 留空給它用就夠。
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [],
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
} satisfies NextAuthConfig;
