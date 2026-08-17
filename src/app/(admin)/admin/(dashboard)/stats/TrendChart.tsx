type TrendPoint = { businessDate: string; orderCount: number; revenue: number };

const WIDTH = 560;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 20, left: 16 };

// 見 SPEC.md §10.5：區間內每日訂單數與營收的雙軸折線圖。專案未安裝圖表套件
// （見 package.json），為兩張簡單圖表另外引入依賴不划算，故手刻極簡 inline SVG。
export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">此區間尚無資料</p>;
  }

  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const maxRevenue = Math.max(1, ...data.map((d) => d.revenue));
  const maxOrders = Math.max(1, ...data.map((d) => d.orderCount));

  const x = (i: number) => (data.length === 1 ? innerWidth / 2 : (i / (data.length - 1)) * innerWidth);
  const yRevenue = (v: number) => innerHeight - (v / maxRevenue) * innerHeight;
  const yOrders = (v: number) => innerHeight - (v / maxOrders) * innerHeight;

  const revenuePoints = data.map((d, i) => `${x(i)},${yRevenue(d.revenue)}`).join(" ");
  const orderPoints = data.map((d, i) => `${x(i)},${yOrders(d.orderCount)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="每日訂單數與營收趨勢圖">
        <g transform={`translate(${PADDING.left},${PADDING.top})`}>
          <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="var(--border)" />
          <polyline points={revenuePoints} fill="none" stroke="var(--primary)" strokeWidth={2} />
          <polyline
            points={orderPoints}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
          {data.map((d, i) => (
            <circle key={`r-${d.businessDate}`} cx={x(i)} cy={yRevenue(d.revenue)} r={3} fill="var(--primary)" />
          ))}
          {data.map((d, i) => (
            <circle key={`o-${d.businessDate}`} cx={x(i)} cy={yOrders(d.orderCount)} r={3} fill="var(--chart-2)" />
          ))}
        </g>
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--primary)" }} />
          營收（左軸）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--chart-2)" }} />
          訂單數（右軸）
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0].businessDate}</span>
        {data.length > 1 && <span>{data[data.length - 1].businessDate}</span>}
      </div>
    </div>
  );
}
