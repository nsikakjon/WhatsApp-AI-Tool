import { describe, expect, it } from "vitest";
import { quoteLine, quoteTotal, type Variant } from "./pricing.js";

const flyers: Variant = {
  id: "v-flyer",
  name: "Flyers: A5, double-sided",
  minQuantity: 50,
  tiers: [
    { minQuantity: 50, unitPriceKobo: 15_000 }, // ₦150 each
    { minQuantity: 500, unitPriceKobo: 10_000 }, // ₦100 each
    { minQuantity: 100, unitPriceKobo: 12_500 }, // ₦125 each (out of order on purpose)
  ],
};

describe("quoteLine", () => {
  it("uses the tier the quantity reaches", () => {
    expect(quoteLine(flyers, 50)).toEqual({
      ok: true,
      line: { variantId: "v-flyer", name: flyers.name, quantity: 50, unitPriceKobo: 15_000, totalKobo: 750_000 },
    });
    const at99 = quoteLine(flyers, 99);
    const at100 = quoteLine(flyers, 100);
    const at1000 = quoteLine(flyers, 1000);
    expect(at99.ok && at99.line.unitPriceKobo).toBe(15_000);
    expect(at100.ok && at100.line.unitPriceKobo).toBe(12_500);
    expect(at1000.ok && at1000.line.totalKobo).toBe(10_000_000); // ₦100,000
  });

  it("refuses orders below the minimum quantity", () => {
    expect(quoteLine(flyers, 10)).toEqual({ ok: false, reason: "below_minimum", minQuantity: 50 });
  });

  it("reports when no tier covers the quantity", () => {
    const gappy: Variant = { ...flyers, minQuantity: 1, tiers: [{ minQuantity: 100, unitPriceKobo: 100 }] };
    expect(quoteLine(gappy, 20)).toEqual({ ok: false, reason: "no_price" });
  });

  it("rejects nonsense quantities", () => {
    expect(() => quoteLine(flyers, 0)).toThrow();
    expect(() => quoteLine(flyers, 2.5)).toThrow();
  });

  it("rejects a price that is not whole kobo", () => {
    const bad: Variant = { ...flyers, tiers: [{ minQuantity: 1, unitPriceKobo: 99.5 }] };
    expect(() => quoteLine(bad, 50)).toThrow();
  });
});

describe("quoteTotal", () => {
  it("adds line totals in kobo", () => {
    const a = quoteLine(flyers, 100);
    const b = quoteLine(flyers, 500);
    if (!a.ok || !b.ok) throw new Error("expected quotes");
    expect(quoteTotal([a.line, b.line])).toBe(1_250_000 + 5_000_000);
    expect(quoteTotal([])).toBe(0);
  });
});
