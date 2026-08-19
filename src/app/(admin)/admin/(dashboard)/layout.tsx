import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  // 見 docs/OPEN-QUESTIONS.md：原本在 middleware 做的登入檢查，改到這裡——
  // (dashboard) route group 涵蓋所有需要登入的後台頁面，/admin/login 不在
  // 這個 group 內，不受影響。
  if (!session) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="flex items-center justify-between border-b bg-background px-6 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/admin/orders">訂單看板</Link>
          <Link href="/admin/products">商品管理</Link>
          <Link href="/admin/categories">分類管理</Link>
          <Link href="/admin/option-groups">規格管理</Link>
          <Link href="/admin/stats">銷售統計</Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{session?.user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/admin/login" });
            }}
          >
            <button type="submit" className="underline">
              登出
            </button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
