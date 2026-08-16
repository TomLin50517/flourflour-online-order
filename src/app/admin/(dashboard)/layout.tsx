import Link from "next/link";
import { auth, signOut } from "@/auth";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="flex items-center justify-between border-b bg-background px-6 py-3">
        <nav className="flex items-center gap-4 text-sm font-medium">
          <Link href="/admin/orders">訂單看板</Link>
          <Link href="/admin/products">商品管理</Link>
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
