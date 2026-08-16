type TopProduct = { productId: string; productNameZh: string; netQuantity: number; netAmount: number };

// 見 SPEC.md §10.5：熱銷 Top 10 長條圖（依淨數量）。同 TrendChart，手刻極簡 SVG/CSS
// 長條，不為此另外引入圖表套件。
export function TopProductsChart({ data }: { data: TopProduct[] }) {
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">此區間尚無資料</p>;
  }
  const max = Math.max(1, ...data.map((d) => Math.max(d.netQuantity, 0)));

  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.productId} className="flex items-center gap-2 text-xs">
          <div className="w-24 shrink-0 truncate text-right text-muted-foreground" title={item.productNameZh}>
            {item.productNameZh}
          </div>
          <div className="h-4 flex-1 rounded bg-muted">
            <div
              className="h-4 rounded bg-primary"
              style={{ width: `${Math.max(2, (Math.max(item.netQuantity, 0) / max) * 100)}%` }}
            />
          </div>
          <div className="w-10 shrink-0 text-right font-medium">{item.netQuantity}</div>
        </div>
      ))}
    </div>
  );
}
