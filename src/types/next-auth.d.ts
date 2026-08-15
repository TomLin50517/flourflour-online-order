import type { DefaultSession } from "@auth/core/types";
import type { AdminRole } from "@/generated/prisma/enums";

declare module "@auth/core/types" {
  interface User {
    role: AdminRole;
  }
  interface Session {
    user: {
      id: string;
      role: AdminRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: AdminRole;
    id?: string;
  }
}
