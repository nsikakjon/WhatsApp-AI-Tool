import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import type { PaidHandler, PaymentLinks } from "../../core/payments/payments.js";

// Plans for the quote and order bot (Free, Starter, Pro, Growth, Enterprise).
//
// Each business is on at most one plan: business #1 (the main number) by
// QUOTE_PLAN, every other business by plan_code on its quote_businesses row.
// With no plan, the bot works as before: no order limit, no credit line.
// Orders are counted per business.
//
// Each plan's price, setup fee, monthly order limit and credit line come from
// the quote_plans table (kobo), never from code or the AI.
//
// Owners upgrade by sending "upgrade starter" (a month) or "upgrade starter
// yearly" (a year at the yearly price). They get a Paystack link; once it's
// paid, planPaid puts the business on the plan until a date (migration 0033).
// When that date passes, the business drops back to the free plan.

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
  /** What the plan adds, e.g. "delivery and riders, broadcasts". */
  description?: string | null;
}

export interface PlanStore {
  plan(code: string): Promise<QuotePlan | null>;
  /** Plans the owner can upgrade to, cheapest first. */
  paidPlans(): Promise<QuotePlan[]>;
  /** This business's orders confirmed since this moment. */
  ordersConfirmedSince(since: Date): Promise<number>;
  /** Optional one-off extras, e.g. "We set it up for you". */
  addons?(): Promise<Array<{ name: string; priceKobo: number }>>;
  /**
   * The plan code saved on this business's row, or null for none. A paid plan
   * whose time has run out reads as "free".
   */
  businessPlanCode?(): Promise<string | null>;
}

/** Saving a paid upgrade on a business's row. */
export interface PlanPaymentStore {
  /** Puts the business on the plan for this many more months; returns the new end date. */
  extendPlan(businessId: string, code: string, months: number): Promise<Date>;
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
  /** The owner's "upgrade starter [yearly]" command: a payment link, or how to upgrade. */
  upgrade?(request: string, ownerWaId: string): Promise<string>;
}

export interface PlanGateOptions {
  /** The plan this business is on (QUOTE_PLAN). Leave out to read it from the business's row. */
  code?: string;
  store: PlanStore;
  /**
   * Paystack checkout links for upgrades, for this business. Without it
   * (PAYSTACK_SECRET_KEY not set), owners are asked to contact yarnOga.
   */
  checkout?: { links: PaymentLinks; businessId: string };
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
      // A plan paid for in the chat (saved on the business's row) wins over QUOTE_PLAN.
      const code = (await paidOrSavedCode()) ?? opts.code ?? null;
      if (!code) return null;
      const plan = await opts.store.plan(code);
      if (!plan) log.error(`Quote plan "${code}" isn't in the quote_plans table; no plan limits apply.`);
      return plan;
    } catch (err) {
      log.error("Could not read the quote plan:", err);
      return null;
    }
  }

  async function paidOrSavedCode(): Promise<string | null> {
    try {
      return (await opts.store.businessPlanCode?.()) ?? null;
    } catch (err) {
      // Most likely migration 0033 hasn't been run yet; QUOTE_PLAN still applies.
      log.error("Could not read the business's saved plan:", err);
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
        lines.push("", "Upgrade:");
        for (const p of upgrades) {
          const yearly =
            p.monthlyPricePaidYearlyKobo != null
              ? ` (${formatNaira(p.monthlyPricePaidYearlyKobo)}/month paid yearly, ${formatNaira(p.monthlyPricePaidYearlyKobo * 12)} a year)`
              : "";
          const setup = p.setupFeeKobo > 0 ? ` + ${formatNaira(p.setupFeeKobo)} setup` : "";
          const what = p.description ? `. ${p.description[0]!.toUpperCase()}${p.description.slice(1)}` : "";
          lines.push(`• ${p.name}: ${formatNaira(p.monthlyPriceKobo)}/month${yearly}${setup}${what}`);
        }
        if (opts.checkout) {
          const example = upgrades[0]!.name.toLowerCase();
          lines.push("", `To upgrade, send *upgrade ${example}* to pay for a month, or *upgrade ${example} yearly* for a year.`);
        }
      }
      const addons = (await opts.store.addons?.()) ?? [];
      if (addons.length > 0) {
        lines.push("", "Extras (one-off):");
        for (const a of addons) lines.push(`• ${a.name}: ${formatNaira(a.priceKobo)}`);
      }
      if (opts.checkout ? addons.length > 0 : upgrades.length > 0 || addons.length > 0) {
        lines.push("", opts.checkout ? "For an extra, contact yarnOga." : "To upgrade or add an extra, contact yarnOga and we'll sort it out.");
      }
      return lines.join("\n");
    },

    async upgrade(request, ownerWaId) {
      const wanted = request.trim().replace(/\s+(yearly|annually|annual|(?:for )?(?:a|one|1) year)$/i, "");
      const yearly = wanted !== request.trim();
      const plans = await opts.store.paidPlans();
      const plan = plans.find((p) => p.code.toLowerCase() === wanted.toLowerCase() || p.name.toLowerCase() === wanted.toLowerCase());
      if (!plan) {
        const names = plans.map((p) => `*upgrade ${p.name.toLowerCase()}*`).join(" or ");
        return names ? `Which plan? Send ${names}. Send *plan* to see the prices.` : "There are no plans to upgrade to just now.";
      }
      if (!opts.checkout) return `To move to ${plan.name}, contact yarnOga and we'll switch you over. Online payment isn't switched on yet.`;

      const months = yearly ? 12 : 1;
      const amountKobo = yearly ? (plan.monthlyPricePaidYearlyKobo ?? plan.monthlyPriceKobo) * 12 : plan.monthlyPriceKobo;
      const period = yearly ? "1 year" : "1 month";
      try {
        const link = await opts.checkout.links.createLink({
          product: "quote",
          waId: ownerWaId,
          amountKobo,
          purpose: { businessId: opts.checkout.businessId, plan: plan.code, months },
          title: `yarnOga ${plan.name}, ${period}`,
        });
        return [
          `Here's your payment link for *${plan.name}* (${period}, ${formatNaira(amountKobo)}):`,
          link,
          "",
          "Your plan switches over as soon as the payment goes through.",
        ].join("\n");
      } catch (err) {
        log.error("Could not make a plan payment link:", err);
        return "Sorry, I couldn't make a payment link just now. Please try again later, or contact yarnOga.";
      }
    },
  };
}

/**
 * What happens once an upgrade is paid: the business moves onto the plan.
 * Only the main number's owner gets a WhatsApp message about it, because
 * payment messages come from the main number; other owners see it on the
 * Paystack page and in their next *plan* reply.
 */
export function createPlanPaidHandler(opts: { store: PlanPaymentStore; mainBusinessId: string }): PaidHandler {
  return async (payment) => {
    const { businessId, plan, months } = payment.purpose as { businessId?: string; plan?: string; months?: number };
    if (!businessId || !plan || !Number.isInteger(months) || months! < 1) {
      throw new Error(`Payment ${payment.reference} is for something we can't find: ${JSON.stringify(payment.purpose)}`);
    }
    const until = await opts.store.extendPlan(businessId, plan, months!);
    if (businessId !== opts.mainBusinessId) return [];
    const date = until.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
    return [{ to: payment.waId, text: `✅ Payment of ${formatNaira(payment.amountKobo)} received, thank you. You're on the plan until ${date}.` }];
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
  description: string | null;
};

const PLAN_COLUMNS = "code, name, monthly_price_kobo, monthly_price_paid_yearly_kobo, setup_fee_kobo, monthly_order_limit, show_credit, description";

function toPlan(row: PlanRow): QuotePlan {
  return {
    code: row.code,
    name: row.name,
    monthlyPriceKobo: Number(row.monthly_price_kobo),
    monthlyPricePaidYearlyKobo: row.monthly_price_paid_yearly_kobo == null ? null : Number(row.monthly_price_paid_yearly_kobo),
    setupFeeKobo: Number(row.setup_fee_kobo),
    monthlyOrderLimit: row.monthly_order_limit,
    showCredit: row.show_credit,
    description: row.description,
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
      return businessId ? readBusinessPlanCode(db, businessId) : null;
    },
  };
}

/**
 * The plan saved on a business's row. A paid plan whose time has run out
 * reads as "free". Shared with features.ts so both agree on the plan.
 */
export async function readBusinessPlanCode(db: SupabaseClient, businessId: string): Promise<string | null> {
  const { data, error } = await db.from("quote_businesses").select("plan_code, plan_paid_until").eq("id", businessId).maybeSingle();
  if (error) throw new Error(`businessPlanCode failed: ${error.message}`);
  const code = (data?.plan_code as string | null | undefined) ?? null;
  const until = data?.plan_paid_until as string | null | undefined;
  return code && until && new Date(until) <= new Date() ? "free" : code;
}

export function createSupabasePlanPayments(db: SupabaseClient): PlanPaymentStore {
  return {
    async extendPlan(businessId, code, months) {
      const { data, error } = await db
        .from("quote_businesses")
        .select("plan_code, plan_paid_until")
        .eq("id", businessId)
        .maybeSingle();
      if (error) throw new Error(`extendPlan read failed: ${error.message}`);
      if (!data) throw new Error(`extendPlan: no business ${businessId}`);
      // Paying again for the same plan adds on to the time left; otherwise the new plan starts now.
      const now = new Date();
      const current = data.plan_paid_until ? new Date(data.plan_paid_until as string) : null;
      const from = data.plan_code === code && current && current > now ? current : now;
      const until = new Date(from);
      until.setUTCMonth(until.getUTCMonth() + months);
      const { error: updateError } = await db
        .from("quote_businesses")
        .update({ plan_code: code, plan_paid_until: until.toISOString(), updated_at: now.toISOString() })
        .eq("id", businessId);
      if (updateError) throw new Error(`extendPlan failed: ${updateError.message}`);
      return until;
    },
  };
}
