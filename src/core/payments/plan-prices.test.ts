import { describe, expect, it, vi } from "vitest";
import { createPlanPrices, parsePlanCurrencies } from "./plan-prices.js";

describe("plan prices in other currencies", () => {
  it("uses the payer's own currency only when it's switched on and priced", async () => {
    const lookup = vi.fn(async (_product: string, plan: string, currency: "GHS" | "KES" | "XOF" | "XAF" | "USD" | "NGN") =>
      plan === "pro" ? { currency, monthlyMinor: 23_000, monthlyPaidYearlyMinor: 19_000 } : null,
    );
    const prices = createPlanPrices({ enabled: ["GHS", "USD"], lookup });
    expect(await prices.forPayer("quote", "pro", "233241234567")).toMatchObject({ currency: "GHS", monthlyMinor: 23_000 });
    expect(await prices.forPayer("quote", "pro", "447700900123")).toMatchObject({ currency: "USD" });
    expect(await prices.forPayer("quote", "starter", "233241234567")).toBeNull();
    expect(await prices.forPayer("quote", "pro", "254712345678")).toBeNull();
    expect(await prices.forPayer("quote", "pro", "2348024777076")).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("reads PLAN_CURRENCIES and refuses anything else", () => {
    expect(parsePlanCurrencies(undefined)).toEqual([]);
    expect(parsePlanCurrencies(" xof, XAF ,ghs,KES,usd ")).toEqual(["XOF", "XAF", "GHS", "KES", "USD"]);
    expect(() => parsePlanCurrencies("NGN")).toThrow("PLAN_CURRENCIES");
    expect(() => parsePlanCurrencies("EUR")).toThrow("EUR");
  });
});
