import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira, formatPayMoney } from "../../core/money.js";
import type { PaidHandler, PaymentLinks } from "../../core/payments/payments.js";
import type { PlanPrices } from "../../core/payments/plan-prices.js";
import { promoAppliedText, promoRefusedText, takePromoCode } from "../../core/payments/promos.js";

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
// yearly" (a year at the yearly price). They get a Paystack link, or one in
// their own currency outside Nigeria (PLAN_CURRENCIES, migration 0062); once it's
// paid, planPaid puts the business on the plan until a date (migration 0033).
// When that date passes, the business drops back to the free plan. A promo
// or referral code goes at the end: "upgrade starter DAYONES". A code given
// in the sign-up chat is used when none is typed.

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
  /** The promo or referral code the business gave when it signed up (migration 0046), or null. */
  signupCode?(): Promise<string | null>;
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
  /**
   * The owner's "plan" command: current plan, this month's use, and how to upgrade.
   * `usage` adds lines under the orders count (e.g. bot messages).
   */
  summary(usage?: string[]): Promise<string>;
  /** The owner's "upgrade starter [yearly]" command: a payment link, or how to upgrade. */
  upgrade?(request: string, ownerWaId: string): Promise<string>;
  /** The cheapest plan above this one, for an Upgrade button; null on the top plan. */
  nextPlan?(): Promise<QuotePlan | null>;
}

export interface PlanGateOptions {
  /** The plan this business is on (QUOTE_PLAN). Leave out to read it from the business's row. */
  code?: string;
  store: PlanStore;
  /**
   * Paystack checkout links for upgrades, for this business. Without it
   * (PAYSTACK_SECRET_KEY not set), owners are asked to contact yarnOga.
   * With prices, owners outside Nigeria pay in their own currency.
   */
  checkout?: { links: PaymentLinks; businessId: string; prices?: PlanPrices };
  /** QUOTE_LIMIT_ALERTS: also warn once when 80% of the month's orders are used. */
  alertAt80?: boolean;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

/** Share of a monthly limit at which owners get the QUOTE_LIMIT_ALERTS heads-up. */
export const ALERT_SHARE = 0.8;

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

  async function savedSignupCode(): Promise<string | null> {
    try {
      return (await opts.store.signupCode?.()) ?? null;
    } catch (err) {
      log.error("Could not read the business's sign-up code:", err);
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
      if (opts.alertAt80 && left >= WARN_WHEN_LEFT && used + 1 === Math.ceil(limit * ALERT_SHARE)) {
        return { allowed: true, warning: `Heads-up: this is order ${used + 1} of ${limit} on your ${plan.name} plan this month.` };
      }
      const warning =
        left < WARN_WHEN_LEFT
          ? `This is order ${used + 1} of ${limit} on your ${plan.name} plan this month${left === 0 ? ". Send *plan* to see how to keep taking orders." : "."}`
          : null;
      return { allowed: true, warning };
    },

    async summary(usage = []) {
      const plan = await current();
      if (!plan) return "I couldn't find your plan just now. Please let yarnOga support know.";
      const used = await opts.store.ordersConfirmedSince(lagosMonthStart(now()));
      const lines = [
        `Your plan: *${plan.name}*`,
        plan.monthlyOrderLimit == null
          ? `Orders this month: ${used} (no limit)`
          : `Orders this month: ${used} of ${plan.monthlyOrderLimit}`,
        ...usage,
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
          lines.push(
            "",
            `To upgrade, send *upgrade ${example}* to pay for a month, or *upgrade ${example} yearly* for a year. Got a promo or referral code? Add it at the end.`,
          );
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

    async nextPlan() {
      const plan = await current();
      if (!plan) return null;
      return (await opts.store.paidPlans()).find((p) => p.monthlyPriceKobo > plan.monthlyPriceKobo) ?? null;
    },

    async upgrade(request, ownerWaId) {
      const plans = await opts.store.paidPlans();
      const find = (text: string) => {
        const wanted = text.trim().replace(/\s+(yearly|annually|annual|(?:for )?(?:a|one|1) year)$/i, "");
        const plan = plans.find((p) => p.code.toLowerCase() === wanted.toLowerCase() || p.name.toLowerCase() === wanted.toLowerCase());
        return plan ? { plan, yearly: wanted !== text.trim() } : null;
      };
      const asked = takePromoCode(request.trim(), (t) => !!find(t));
      const found = find(asked.text);
      if (!found) {
        const names = plans.map((p) => `*upgrade ${p.name.toLowerCase()}*`).join(" or ");
        return names ? `Which plan? Send ${names}. Send *plan* to see the prices.` : "There are no plans to upgrade to just now.";
      }
      const { plan, yearly } = found;
      if (!opts.checkout) return `To move to ${plan.name}, contact yarnOga and we'll switch you over. Online payment isn't switched on yet.`;

      const months = yearly ? 12 : 1;
      const period = yearly ? "1 year" : "1 month";
      try {
        const local = (await opts.checkout.prices?.forPayer("quote", plan.code, ownerWaId)) ?? null;
        const currency = local?.currency ?? "NGN";
        const perMonth = local
          ? (yearly ? (local.monthlyPaidYearlyMinor ?? local.monthlyMinor) : local.monthlyMinor)
          : yearly
            ? (plan.monthlyPricePaidYearlyKobo ?? plan.monthlyPriceKobo)
            : plan.monthlyPriceKobo;
        const amountKobo = perMonth * months;
        const signupCode = asked.code ? null : await savedSignupCode();
        const code = asked.code ?? signupCode;
        const request = {
          product: "quote",
          waId: ownerWaId,
          amountKobo,
          ...(local ? { currency } : {}),
          purpose: { businessId: opts.checkout.businessId, plan: plan.code, months },
          title: `yarnOga ${plan.name}, ${period}`,
        };
        let link = await opts.checkout.links.createLink({ ...request, promo: code ? { code, months } : undefined });
        // The sign-up code only counts once; after that (or once it has ended) the owner pays the full price.
        if (link.url === null && signupCode) link = await opts.checkout.links.createLink(request);
        if (link.url === null) return promoRefusedText(link.refused);
        return [
          `Here's your payment link for *${plan.name}* (${period}, ${formatPayMoney(link.amountKobo, currency)}):`,
          link.url,
          ...(link.promo ? ["", promoAppliedText(link.promo)] : []),
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
export function createPlanPaidHandler(opts: {
  store: PlanPaymentStore;
  mainBusinessId: string;
  /** With QUOTE_REFERRALS on: gives the free month to whoever shared a referral code used on a payment. */
  rewardReferral?: (code: string) => Promise<unknown>;
  log?: Pick<Console, "error">;
}): PaidHandler {
  const log = opts.log ?? console;
  return async (payment) => {
    const { businessId, plan, months } = payment.purpose as { businessId?: string; plan?: string; months?: number };
    if (!businessId || !plan || !Number.isInteger(months) || months! < 1) {
      throw new Error(`Payment ${payment.reference} is for something we can't find: ${JSON.stringify(payment.purpose)}`);
    }
    const until = await opts.store.extendPlan(businessId, plan, months!);
    if (opts.rewardReferral && payment.promoCode) {
      // The payer's plan is already saved, so a failure here mustn't send the payment back to pending.
      try {
        await opts.rewardReferral(payment.promoCode);
      } catch (err) {
        log.error(`Paid with code ${payment.promoCode}, but couldn't give the referrer their free month:`, err);
      }
    }
    if (businessId !== opts.mainBusinessId) return [];
    const date = until.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
    return [{ to: payment.waId, text: `✅ Payment of ${formatPayMoney(payment.amountKobo, payment.currency ?? "NGN")} received, thank you. You're on the plan until ${date}.` }];
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
    async signupCode() {
      if (!businessId) return null;
      const { data, error } = await db.from("quote_businesses").select("referral_code").eq("id", businessId).maybeSingle();
      if (error) throw new Error(`signupCode failed: ${error.message}`);
      return (data?.referral_code as string | null | undefined) ?? null;
    },
  };
}

/**
 * The plan saved on a business's row (or its main business's, for a branch).
 * A paid plan whose time has run out reads as "free". Shared with
 * features.ts so both agree on the plan.
 */
export async function readBusinessPlanCode(db: SupabaseClient, businessId: string): Promise<string | null> {
  const row = async (id: string) => {
    // Every column, so branch_of (migration 0038) is used when it's there.
    const { data, error } = await db.from("quote_businesses").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`businessPlanCode failed: ${error.message}`);
    return data as { plan_code?: string | null; plan_paid_until?: string | null; plan_grace_until?: string | null; branch_of?: string | null } | null;
  };
  let data = await row(businessId);
  // A branch is on its main business's plan.
  if (data?.branch_of) data = await row(data.branch_of);
  const code = data?.plan_code ?? null;
  return code && data && planLapsed(data) ? "free" : code;
}

/**
 * True when a paid plan's time, and any grace period after it (migration
 * 0064, QUOTE_PLAN_RENEWALS), has run out. A plan with no end date never lapses.
 */
export function planLapsed(row: { plan_paid_until?: string | null; plan_grace_until?: string | null }, now = new Date()): boolean {
  if (!row.plan_paid_until) return false;
  const end = Math.max(new Date(row.plan_paid_until).getTime(), row.plan_grace_until ? new Date(row.plan_grace_until).getTime() : 0);
  return end <= now.getTime();
}

export function createSupabasePlanPayments(db: SupabaseClient): PlanPaymentStore {
  return {
    async extendPlan(businessId, code, months) {
      const { data, error } = await db
        .from("quote_businesses")
        .select("*")
        .eq("id", businessId)
        .maybeSingle();
      if (error) throw new Error(`extendPlan read failed: ${error.message}`);
      if (!data) throw new Error(`extendPlan: no business ${businessId}`);
      // Paying again for the same plan adds on to the time left, and a renewal
      // paid in the grace period (migration 0064) carries on from the old end
      // date. Otherwise the new plan starts now.
      const now = new Date();
      const current = data.plan_paid_until ? new Date(data.plan_paid_until as string) : null;
      const from = data.plan_code === code && current && !planLapsed(data, now) ? current : now;
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
