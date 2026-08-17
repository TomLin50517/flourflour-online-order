import { OrderStatusView } from "./OrderStatusView";

// 見 SPEC.md §9.6：整個系統對顧客最重要的畫面。accessToken 可由 sessionStorage 或 ?t= 帶入。
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderNo: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { orderNo } = await params;
  const { t: tokenFromQuery } = await searchParams;

  return <OrderStatusView orderNo={orderNo} tokenFromQuery={tokenFromQuery} />;
}
