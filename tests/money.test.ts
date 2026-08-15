import { describe, expect, it } from "vitest";
import {
  calcLineTotal,
  calcSubtotal,
  calcUnitPrice,
  sumPriceDeltas,
} from "@/lib/money";

describe("sumPriceDeltas", () => {
  it("sums an empty list to 0", () => {
    expect(sumPriceDeltas([])).toBe(0);
  });

  it("sums positive and negative deltas", () => {
    expect(sumPriceDeltas([10, -5, 20])).toBe(25);
  });
});

describe("calcUnitPrice", () => {
  it("returns the base price when there are no options", () => {
    expect(calcUnitPrice(80, [])).toBe(80);
  });

  it("adds option price deltas to the base price", () => {
    expect(calcUnitPrice(80, [10, 25])).toBe(115);
  });

  it("allows negative deltas to discount the base price", () => {
    expect(calcUnitPrice(100, [-20])).toBe(80);
  });
});

describe("calcLineTotal", () => {
  it("multiplies unit price by quantity", () => {
    expect(calcLineTotal(115, 3)).toBe(345);
  });

  it("returns 0 for a zero quantity", () => {
    expect(calcLineTotal(115, 0)).toBe(0);
  });
});

describe("calcSubtotal", () => {
  it("sums an empty list of line totals to 0", () => {
    expect(calcSubtotal([])).toBe(0);
  });

  it("sums multiple line totals", () => {
    expect(calcSubtotal([345, 80, 150])).toBe(575);
  });
});
