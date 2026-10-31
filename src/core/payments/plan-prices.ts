import type { SupabaseClient } from "@supabase/supabase-js";
import { isPayCurrency, payCurrencyFor, type PayCurrency } from "../money.js";

// yarnOga's own plans in the payer's currency. Naira prices live with each
// product (quote_plans, flyer_plans); the fixed prices in other currencies
// live in plan_prices (migration 0062). A payer is charged in the currency of
// their WhatsApp number's country when PLAN_CURRENCIES switches it on and the
// plan has a price in it. Otherwise they pay in naira, as before.

export interface PlanPrice {
  currency: PayCurrency;
  /** In hundredths of the currency. */
  monthlyMinor: number;
  /** Per month when paid a year at a time; null = no yearly price. */
  monthlyPaidYearlyMinor: number | null;
}

export interface PlanPrices {
  /** The plan's price for this payer in their own currency, or null to charge naira. */
  forPayer(product: "quote" | "flyer", plan: string, waId: string): Promise<PlanPrice | null>;
}

export type PlanPriceLookup = (product: string, plan: string, currency: PayCurrency) => Promise<PlanPrice | null>;

export function createPlanPrices(opts: { enabled: PayCurrency[]; lookup: PlanPriceLookup }): PlanPrices {
  return {
    async forPayer(product, plan, waId) {
      const currency = payCurrencyFor(waId);
      if (currency === "NGN" || !opts.enabled.includes(currency)) return null;
      return opts.lookup(product, plan, currency);
    },
  };
}

export function createSupabasePlanPriceLookup(db: SupabaseClient): PlanPriceLookup {
  return async (product, plan, currency) => {
    const { data, error } = await db
      .from("plan_prices")
      .select("currency, monthly_price_minor, monthly_price_paid_yearly_minor")
      .eq("product", product)
      .eq("plan_code", plan)
      .eq("currency", currency)
      .maybeSingle();
    if (error) throw new Error(`plan price lookup failed: ${error.message}`);
    if (!data || !isPayCurrency(data.currency)) return null;
    return {
      currency: data.currency,
      monthlyMinor: Number(data.monthly_price_minor),
      monthlyPaidYearlyMinor: data.monthly_price_paid_yearly_minor == null ? null : Number(data.monthly_price_paid_yearly_minor),
    };
  };
}

/** Reads PLAN_CURRENCIES, e.g. "XOF,XAF,GHS,KES,USD". Naira is always on. */
export function parsePlanCurrencies(value: string | undefined): PayCurrency[] {
  const codes = (value ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const bad = codes.filter((c) => !isPayCurrency(c) || c === "NGN");
  if (bad.length) throw new Error(`PLAN_CURRENCIES can list XOF, XAF, GHS, KES and USD (got ${bad.join(", ")})`);
  return codes as PayCurrency[];
}
