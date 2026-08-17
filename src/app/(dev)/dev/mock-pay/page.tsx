import { notFound } from "next/navigation";
import { MockPayButtons } from "./MockPayButtons";

// 見 SPEC.md §7.4：僅 NODE_ENV !== "production" 才註冊此開發用付款模擬頁。
export default async function MockPayPage({
  searchParams,
}: {
  searchParams: Promise<{ orderNo?: string; paymentId?: string }>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const { orderNo, paymentId } = await searchParams;
  if (!orderNo || !paymentId) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <p className="text-sm text-muted-foreground">開發用付款模擬頁（僅開發環境可用）</p>
        <p className="mt-2 text-lg font-semibold">訂單 {orderNo}</p>
      </div>
      <MockPayButtons orderNo={orderNo} paymentId={paymentId} />
    </main>
  );
}
