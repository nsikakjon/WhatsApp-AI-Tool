import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";

// Plans for the quote and order bot (Free, Starter, Standard).
//
// Each business is on at most one plan: business #1 (the main number) by
// QUOTE_PLAN, every other business by plan_code on its quote_businesses row.
// With no plan, the bot works as before: no order limit, no credit line.
// Orders are counted per business.
//
// Each plan's price, setup fee, monthly order limit and credit line come from
// the quote_plans table (kobo), never from code or the AI.

export interface QuotePlan {
  code: string;
  name: string;
  monthlyPriceKobo: number;
  /** Price per month when paid a year at a time. Null = no yearly price. */
  monthlyPricePaidYearlyKobo: number | null;
  setupFeeKobo: number;
  /** Confirmed orders allowed per calendar month (Lagos time). Null = no limit. */
  monthlyOrderLimit: number | null;
  /** Adds "Powered by yarnOga" under quotes and confirmations. */
  showCredit: boolean;
}

export interface PlanStore {
  plan(code: string): Promise<QuotePlan | null>;
  /** Plans the owner can upgrade to, cheapest first. */
  paidPlans(): Promise<QuotePlan[]>;
  /** This business's orders confirmed since this moment. */
  ordersConfirmedSince(since: Date): Promise<number>;
  /** Optional one-off extras, e.g. "We set it up for you". */
  addons?(): Promise<Array<{ name: string; priceKobo: number }>>;
  /** The plan code saved on this business's row, or null for none. */
  businessPlanCode?(): Promise<string | null>;
}

export const CREDIT_LINE = "_Powered by yarnOga · yarnoga.com_";

/** Owners get a heads-up on each of the last few free orders of the month. */
const WARN_WHEN_LEFT = 5;

export type OrderCheck =
  | { allowed: true; warning: string | null }
  | { allowed: false; used: number; limit: number; planName: string };

export interface PlanGate {
  /** The credit line to add to a customer message, or null for none. */
  credit(): Promise<string | null>;
  /** Whether one more order can be confirmed this month. */
  checkOrder(): Promise<OrderCheck>;
  /** The owner's "plan" command: current plan, this month's use, and how to upgrade. */
  summary(): Promise<string>;
}

export interface PlanGateOptions {
  /** The plan this business is on (QUOTE_PLAN). Leave out to read it from the business's row. */
  code?: string;
  store: PlanStore;
  /**
   * Makes a payment link for a paid plan. Not built yet: online payment for
   * plans arrives with Flutterwave (PR #9). Until then, owners are asked to
   * contact yarnOga.
   */
  upgradeLink?: (plan: QuotePlan) => Promise<string | null>;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

/** Midnight on the 1st of this month, Lagos time (UTC+1 all year). */
export function lagosMonthStart(now: Date): Date {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), 1) - 60 * 60 * 1000);
}

export function createPlanGate(opts: PlanGateOptions): PlanGate {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;

  // A database hiccup should never stop a sale, so problems here let the
  // order through and are logged.
  async function current(): Promise<QuotePlan | null> {
    try {
      const code = opts.code ?? (await opts.store.businessPlanCode?.()) ?? null;
      if (!code) return null;
      const plan = await opts.store.plan(code);
      if (!plan) log.error(`Quote plan "${code}" isn't in the quote_plans table; no plan limits apply.`);
      return plan;
    } catch (err) {
      log.error("Could not read the quote plan:", err);
      return null;
    }
  }

  return {
    async credit() {
      const plan = await current();
      return plan?.showCredit ? CREDIT_LINE : null;
    },

    async checkOrder() {
      const plan = await current();
      const limit = plan?.monthlyOrderLimit;
      if (!plan || limit == null) return { allowed: true, warning: null };
      let used: number;
      try {
        used = await opts.store.ordersConfirmedSince(lagosMonthStart(now()));
      } catch (err) {
        log.error("Could not count this month's orders:", err);
        return { allowed: true, warning: null };
      }
      if (used >= limit) return { allowed: false, used, limit, planName: plan.name };
      const left = limit - used - 1;
      const warning =
        left < WARN_WHEN_LEFT
          ? `This is order ${used + 1} of ${limit} on your ${plan.name} plan this month${left === 0 ? ". Send *plan* to see how to keep taking orders." : "."}`
          : null;
      return { allowed: true, warning };
    },

    async summary() {
      const plan = await current();
      if (!plan) return "I couldn't find your plan just now. Please let yarnOga support know.";
      const used = await opts.store.ordersConfirmedSince(lagosMonthStart(now()));
      const lines = [
        `Your plan: *${plan.name}*`,
        plan.monthlyOrderLimit == null
          ? `Orders this month: ${used} (no limit)`
          : `Orders this month: ${used} of ${plan.monthlyOrderLimit}`,
      ];
      const upgrades = (await opts.store.paidPlans()).filter((p) => p.monthlyPriceKobo > plan.monthlyPriceKobo);
      if (upgrades.length > 0) {
        lines.push("", "Upgrade for unlimited orders and no yarnOga line on your messages:");
        for (const p of upgrades) {
          const yearly =
            p.monthlyPricePaidYearlyKobo != null
              ? ` (${formatNaira(p.monthlyPricePaidYearlyKobo)}/month paid yearly, ${formatNaira(p.monthlyPricePaidYearlyKobo * 12)} a year)`
              : "";
          const setup = p.setupFeeKobo > 0 ? ` + ${formatNaira(p.setupFeeKobo)} setup` : "";
          const link = opts.upgradeLink ? await opts.upgradeLink(p) : null;
          lines.push(`• ${p.name}: ${formatNaira(p.monthlyPriceKobo)}/month${yearly}${setup}${link ? `\n  ${link}` : ""}`);
        }
      }
      const addons = (await opts.store.addons?.()) ?? [];
      if (addons.length > 0) {
        lines.push("", "Extras (one-off):");
        for (const a of addons) lines.push(`• ${a.name}: ${formatNaira(a.priceKobo)}`);
      }
      if ((upgrades.length > 0 || addons.length > 0) && !opts.upgradeLink) {
        lines.push("", "To upgrade or add an extra, contact yarnOga and we'll sort it out.");
      }
      return lines.join("\n");
    },
  };
}

type PlanRow = {
  code: string;
  name: string;
  monthly_price_kobo: number | string;
  monthly_price_paid_yearly_kobo: number | string | null;
  setup_fee_kobo: number | string;
  monthly_order_limit: number | null;
  show_credit: boolean;
};

const PLAN_COLUMNS = "code, name, monthly_price_kobo, monthly_price_paid_yearly_kobo, setup_fee_kobo, monthly_order_limit, show_credit";

function toPlan(row: PlanRow): QuotePlan {
  return {
    code: row.code,
    name: row.name,
    monthlyPriceKobo: Number(row.monthly_price_kobo),
    monthlyPricePaidYearlyKobo: row.monthly_price_paid_yearly_kobo == null ? null : Number(row.monthly_price_paid_yearly_kobo),
    setupFeeKobo: Number(row.setup_fee_kobo),
    monthlyOrderLimit: row.monthly_order_limit,
    showCredit: row.show_credit,
  };
}

/**
 * Plans from the quote_plans table. With a business id, orders are counted
 * for that business only and its plan_code can be read; without one (multi-
 * business off) every order counts, as before.
 */
export function createSupabasePlanStore(db: SupabaseClient, businessId?: string): PlanStore {
  return {
    async plan(code) {
      const { data, error } = await db.from("quote_plans").select(PLAN_COLUMNS).eq("code", code).maybeSingle();
      if (error) throw new Error(`plan failed: ${error.message}`);
      return data ? toPlan(data as PlanRow) : null;
    },
    async paidPlans() {
      const { data, error } = await db
        .from("quote_plans")
        .select(PLAN_COLUMNS)
        .eq("active", true)
        .gt("monthly_price_kobo", 0)
        .order("sort_order");
      if (error) throw new Error(`paidPlans failed: ${error.message}`);
      return (data ?? []).map((row) => toPlan(row as PlanRow));
    },
    async ordersConfirmedSince(since) {
      let query = db
        .from("quote_orders")
        .select("id", { count: "exact", head: true })
        .gte("confirmed_at", since.toISOString());
      if (businessId) query = query.eq("business_id", businessId);
      const { count, error } = await query;
      if (error) throw new Error(`ordersConfirmedSince failed: ${error.message}`);
      return count ?? 0;
    },
    async addons() {
      const { data, error } = await db.from("quote_addons").select("name, price_kobo").eq("active", true).order("sort_order");
      if (error) throw new Error(`addons failed: ${error.message}`);
      return (data ?? []).map((row) => ({ name: row.name as string, priceKobo: Number(row.price_kobo) }));
    },
    async businessPlanCode() {
      if (!businessId) return null;
      const { data, error } = await db.from("quote_businesses").select("plan_code").eq("id", businessId).maybeSingle();
      if (error) throw new Error(`businessPlanCode failed: ${error.message}`);
      return (data?.plan_code as string | null | undefined) ?? null;
    },
  };
}
