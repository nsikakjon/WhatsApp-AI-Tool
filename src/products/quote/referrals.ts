import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanPaymentStore } from "./plan.js";

// Referral codes for the quote bot (QUOTE_REFERRALS, migration 0041).
//
// Each business gets its own code by sending "referral". Another business adds
// it to an upgrade ("upgrade starter KAHNP4821") and gets the code's discount
// off its first month: 10% unless changed on the code's row in promo_codes.
// Once that payment goes through, the business that shared the code gets a
// free month of its paid plan, or a month of Starter if it's on Free.

const REWARD_PLAN = "starter";

export interface ReferralStore {
  /** The business's code, made the first time it's asked for. */
  codeFor(businessId: string, businessName: string): Promise<{ code: string; percentOff: number }>;
  /** How many businesses have paid with this business's code. */
  timesUsed(code: string): Promise<number>;
  /** The business that shared this code, or null when it isn't a referral code. */
  referrerOf(code: string): Promise<string | null>;
  /** The plan saved on a business's row. */
  savedPlan(businessId: string): Promise<{ code: string | null; until: Date | null } | null>;
}

export async function referralReply(store: ReferralStore, businessId: string, businessName: string): Promise<string> {
  const { code, percentOff } = await store.codeFor(businessId, businessName);
  const used = await store.timesUsed(code);
  return [
    `Your referral code is *${code}*.`,
    "",
    `Share it with other businesses. When they upgrade on yarnOga, they add it at the end, e.g. *upgrade starter ${code}*, and get ${percentOff}% off their first month.`,
    "Once they've paid, you get a free month of your plan (or of Starter if you're on Free).",
    "",
    `Businesses that have paid with your code so far: ${used}.`,
  ].join("\n");
}

/**
 * Gives the referrer its free month. A plan set by hand with no end date
 * already never runs out, so it's left alone; so is business #1, whose plan
 * comes from QUOTE_PLAN.
 */
export async function rewardReferrer(opts: {
  code: string;
  store: ReferralStore;
  plans: PlanPaymentStore;
  mainBusinessId: string;
  now?: Date;
}): Promise<{ businessId: string; plan: string; until: Date } | null> {
  const referrer = await opts.store.referrerOf(opts.code);
  if (!referrer || referrer === opts.mainBusinessId) return null;
  const saved = await opts.store.savedPlan(referrer);
  if (!saved) return null;
  if (saved.code && saved.code !== "free" && !saved.until) return null;
  const now = opts.now ?? new Date();
  const onPaidPlan = saved.code && saved.code !== "free" && saved.until && saved.until > now;
  const plan = onPaidPlan ? saved.code! : REWARD_PLAN;
  return { businessId: referrer, plan, until: await opts.plans.extendPlan(referrer, plan, 1) };
}

/** Up to five letters of the name and four digits, e.g. "Kahn Prints" -> KAHNP4821. */
export function newReferralCode(businessName: string, digits: () => number = () => randomInt(1000, 10000)): string {
  const letters = businessName
    .normalize("NFD")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 5);
  return `${letters || "SHOP"}${digits()}`;
}

export function createSupabaseReferrals(db: SupabaseClient): ReferralStore {
  async function existing(businessId: string) {
    const { data, error } = await db.from("promo_codes").select("code, percent_off").eq("referrer_business_id", businessId).maybeSingle();
    if (error) throw new Error(`referral code lookup failed: ${error.message}`);
    return data ? { code: data.code as string, percentOff: data.percent_off as number } : null;
  }

  return {
    async codeFor(businessId, businessName) {
      const found = await existing(businessId);
      if (found) return found;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db
          .from("promo_codes")
          .insert({ code: newReferralCode(businessName), product: "quote", referrer_business_id: businessId })
          .select("code, percent_off")
          .single();
        if (!error) return { code: data.code as string, percentOff: data.percent_off as number };
        // 23505: that code is taken, or this business got its code a moment ago.
        if (error.code !== "23505") throw new Error(`referral code failed: ${error.message}`);
        const raced = await existing(businessId);
        if (raced) return raced;
      }
      throw new Error("Couldn't find a free referral code after 5 tries");
    },

    async timesUsed(code) {
      const { data, error } = await db.from("payments").select("wa_id").eq("promo_code", code).eq("status", "paid");
      if (error) throw new Error(`referral count failed: ${error.message}`);
      return new Set((data ?? []).map((r) => r.wa_id)).size;
    },

    async referrerOf(code) {
      const { data, error } = await db.from("promo_codes").select("referrer_business_id").eq("code", code).maybeSingle();
      if (error) throw new Error(`referrer lookup failed: ${error.message}`);
      return (data?.referrer_business_id as string | null) ?? null;
    },

    async savedPlan(businessId) {
      const { data, error } = await db.from("quote_businesses").select("plan_code, plan_paid_until").eq("id", businessId).maybeSingle();
      if (error) throw new Error(`saved plan lookup failed: ${error.message}`);
      if (!data) return null;
      return { code: data.plan_code ?? null, until: data.plan_paid_until ? new Date(data.plan_paid_until) : null };
    },
  };
}
