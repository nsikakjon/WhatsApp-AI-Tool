import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanFeatures } from "./features.js";
import { lagosMonthStart } from "./plan.js";

// AI credits: how many customer messages the AI may read for a business each
// month, set per plan in quote_plan_features ("ai_credits", migration 0025).
// One credit = one customer message read by the AI.
//
// When the credits run out the bot doesn't stop: it switches to simple
// keyword and menu replies (fallback.ts) until the 1st of next month, so
// quotes and orders keep working. The owner is told at 80% and when they run
// out. A business with no plan, or a plan with no cap, isn't counted.
// With top-ups (topups.ts), replies the owner bought this month are added on.

export interface CreditStore {
  /** Adds one credit for this month (first day, YYYY-MM-DD) and returns the new total. */
  use(month: string): Promise<number>;
}

export type CreditCheck = {
  /** True: use the AI. False: use the keyword replies. */
  useAi: boolean;
  /** A message for the business owner, sent once at 80% and once when credits run out. */
  ownerNotice: string | null;
  /** True on the message that used the last credit, when ownerNotice says they've run out. */
  usedUp?: boolean;
};

export interface AiCredits {
  /** Spends one credit for an incoming customer message. */
  spend(): Promise<CreditCheck>;
}

export interface AiCreditsOptions {
  features: PlanFeatures;
  store: CreditStore;
  /** AI reply packs bought this month (topups.ts). Without it, the plan's replies are all there is. */
  topUps?: { extra(month: string): Promise<number> };
  now?: () => Date;
  log?: Pick<Console, "error">;
}

/** The owner hears once when this share of the month's credits is used. */
const WARN_AT = 0.8;

/** The Lagos month as its first day, e.g. "2026-10-01". */
export function lagosMonthKey(now: Date): string {
  const start = new Date(lagosMonthStart(now).getTime() + 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

export function createAiCredits(opts: AiCreditsOptions): AiCredits {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;

  return {
    async spend() {
      const included = await opts.features.has("ai_credits");
      const limit = included ? await opts.features.limit("ai_credits") : 0;
      if (limit == null) return { useAi: true, ownerNotice: null };

      const month = lagosMonthKey(now());
      let used: number;
      let allowed: number;
      try {
        [used, allowed] = await Promise.all([
          opts.store.use(month),
          included && opts.topUps ? opts.topUps.extra(month).then((extra) => limit + extra) : limit,
        ]);
      } catch (err) {
        // A database hiccup shouldn't make the bot worse for the customer.
        log.error("Could not count AI credits:", err);
        return { useAi: true, ownerNotice: null };
      }

      const warnAt = Math.ceil(allowed * WARN_AT);
      const options = opts.topUps ? "Send *top up* to buy more replies, or *plan* to see the plans." : "Send *plan* to see how to upgrade.";
      let ownerNotice: string | null = null;
      if (used === allowed + 1) {
        ownerNotice =
          `You've used all ${allowed} AI replies on your plan this month. Your bot is still taking quotes and orders, ` +
          `but with simple menu replies (customers pick an item number) until the 1st. ${options}`;
      } else if (allowed > 0 && used === warnAt && warnAt < allowed) {
        ownerNotice = `Heads-up: you've used ${used} of your ${allowed} AI replies this month. ${opts.topUps ? options : "Send *plan* to see your options."}`;
      }
      return { useAi: used <= allowed, ownerNotice, ...(used === allowed + 1 ? { usedUp: true } : {}) };
    },
  };
}

export function createSupabaseCreditStore(db: SupabaseClient, businessId: string): CreditStore {
  return {
    async use(month) {
      const { data, error } = await db.rpc("quote_use_ai_credit", { p_business_id: businessId, p_month: month });
      if (error) throw new Error(`quote_use_ai_credit failed: ${error.message}`);
      return Number(data);
    },
  };
}
