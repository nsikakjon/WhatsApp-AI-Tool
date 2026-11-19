import { describe, expect, it } from "vitest";
import { quoteLine } from "./pricing.js";
import { activeSale, saleEndsAt, saleLastDate, salePrice, saleTiers } from "./sale.js";

describe("sales", () => {
  const now = new Date("2026-11-20T12:00:00Z");

  it("runs until the end of its last day in Lagos", () => {
    const ends = saleEndsAt("2026-11-30")!;
    expect(ends.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(saleLastDate(ends)).toBe("2026-11-30");
    expect(saleEndsAt("2026-02-31")).toBeNull();
    expect(activeSale({ sale_percent: 20, sale_ends_at: ends.toISOString() }, now)).toEqual({ percent: 20, endsAt: ends });
    expect(activeSale({ sale_percent: 20, sale_ends_at: ends.toISOString() }, new Date("2026-11-30T23:00:00Z"))).toBeNull();
    expect(activeSale({ sale_percent: null, sale_ends_at: ends.toISOString() }, now)).toBeNull();
    expect(activeSale({}, now)).toBeNull();
  });

  it("takes the percentage off every price, to a whole naira, so quotes match the shop", () => {
    expect(salePrice(1_250_000, 20)).toBe(1_000_000);
    expect(salePrice(999_900, 15)).toBe(849_900);
    expect(salePrice(15_050, 10)).toBe(13_500);
    const tiers = saleTiers([{ minQuantity: 1, unitPriceKobo: 450_000 }, { minQuantity: 10, unitPriceKobo: 400_000 }], { percent: 20, endsAt: now });
    expect(tiers).toEqual([{ minQuantity: 1, unitPriceKobo: 360_000 }, { minQuantity: 10, unitPriceKobo: 320_000 }]);
    const quote = quoteLine({ id: "v", name: "Mugs: White", minQuantity: 1, tiers }, 12);
    expect(quote.ok && quote.line.totalKobo).toBe(3_840_000);
  });
});
