// 見 CLAUDE.md 硬性規則：金額一律 Int，最小貨幣單位；禁止 float/double/字串運算。
// 所有金額計算集中於此檔的純函式。

export function sumPriceDeltas(deltas: number[]): number {
  return deltas.reduce((sum, delta) => sum + delta, 0);
}

export function calcUnitPrice(basePrice: number, optionPriceDeltas: number[]): number {
  return basePrice + sumPriceDeltas(optionPriceDeltas);
}

export function calcLineTotal(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

export function calcSubtotal(lineTotals: number[]): number {
  return lineTotals.reduce((sum, total) => sum + total, 0);
}
