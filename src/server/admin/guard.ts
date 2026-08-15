import { auth } from "@/auth";
import { AppError } from "@/lib/errors";

export async function requireStaff() {
  const session = await auth();
  if (!session?.user) {
    throw new AppError("UNAUTHORIZED", "請先登入");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireStaff();
  if (session.user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "需要管理者權限");
  }
  return session;
}
