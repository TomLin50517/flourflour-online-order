import bcrypt from "bcrypt";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getClientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/db";
import { clearLoginFailures, isLockedOut, recordLoginFailure } from "@/lib/login-guard";
import { checkRateLimit } from "@/lib/rate-limit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
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

        const user = await prisma.adminUser.findUnique({ where: { email } });
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

        await prisma.adminUser.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return { id: user.id, email: user.email, name: user.displayName, role: user.role };
      },
    }),
  ],
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
});
