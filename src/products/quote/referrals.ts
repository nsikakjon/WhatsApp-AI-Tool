import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanPaymentStore } from "./plan.js";

// Referral codes for the quote bot (QUOTE_REFERRALS, migrations 0041, 0042).
//
// Each business gets a code by sending "referral", and can make more with
// names of its own ("new code HOLIDAYS"). Another business adds one to an
// upgrade ("upgrade starter HOLIDAYS") and gets the code's discount off its
// first month: 10% unless changed on the code's row in promo_codes. Once that
// payment goes through, the business that shared the code gets a free month
// of its paid plan, or a month of Starter if it's on Free.

const REWARD_PLAN = "starter";
const MAX_CODES = 10;

export interface ReferralCode {
  code: string;
  percentOff: number;
  active: boolean;
  /** Businesses that have paid with it. */
  used: number;
}

export interface ReferralStore {
  /** The business's first code, made the first time it's asked for. */
  codeFor(businessId: string, businessName: string): Promise<{ code: string; percentOff: number }>;
  /** All the business's codes, oldest first. */
  codes(businessId: string): Promise<ReferralCode[]>;
  /** "taken" when any business (or a promo code) already has that name. */
  addCode(businessId: string, code: string): Promise<"added" | "taken">;
  /** False when the business has no such code. */
  setActive(businessId: string, code: string, active: boolean): Promise<boolean>;
  /** The business that shared this code, or null when it isn't a referral code. */
  referrerOf(code: string): Promise<string | null>;
  /** The plan saved on a business's row. */
  savedPlan(businessId: string): Promise<{ code: string | null; until: Date | null } | null>;
}

const HOW_TO =
  "To make another code, send *new code* and a name, e.g. *new code HOLIDAYS* (letters and numbers, 4 to 20 of them). To pause one, send *code HOLIDAYS off*, and *on* to start it again.";

async function listReply(store: ReferralStore, businessId: string, businessName: string, lead?: string): Promise<string> {
  const first = await store.codeFor(businessId, businessName);
  const codes = await store.codes(businessId);
  const lines = codes.map(
    (c) => `• *${c.code}* (${c.percentOff}% off): ${c.used} business${c.used === 1 ? "" : "es"} paid with it${c.active ? "" : ", paused"}`,
  );
  return [
    ...(lead ? [lead, ""] : []),
    codes.length === 1 ? `Your referral code is *${first.code}*.` : "Your referral codes:",
    ...(codes.length === 1 ? [] : lines),
    "",
    `Share ${codes.length === 1 ? "it" : "them"} with other businesses. When they upgrade on yarnOga, they add it at the end, e.g. *upgrade starter ${first.code}*, and get money off their first month${codes.length === 1 ? ` (${first.percentOff}%)` : ""}.`,
    "Once they've paid, you get a free month of your plan (or of Starter if you're on Free).",
    ...(codes.length === 1 ? ["", `Businesses that have paid with your code so far: ${codes[0]!.used}.`] : []),
    "",
    HOW_TO,
  ].join("\n");
}

/** The owner's referral commands. Null when the message isn't one. */
export async function referralCommand(store: ReferralStore, businessId: string, businessName: string, text: string): Promise<string | null> {
  const t = text.trim();
  if (/^(my )?(referrals?|refer|invite)( codes?)?$|^my codes?$/i.test(t)) return listReply(store, businessId, businessName);

  const add = t.match(/^(?:new|add|make|create)\s+(?:referral\s+)?code\s+(\S+)$/i);
  if (add) {
    const code = add[1]!.toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) return "A code can only have letters and numbers, 4 to 20 of them, e.g. *new code HOLIDAYS*.";
    await store.codeFor(businessId, businessName);
    if ((await store.codes(businessId)).length >= MAX_CODES) {
      return `You already have ${MAX_CODES} codes, which is the most a business can have. Send *referral* to see them.`;
    }
    if ((await store.addCode(businessId, code)) === "taken") return `*${code}* is already taken. Please try another name.`;
    return listReply(store, businessId, businessName, `Done. *${code}* is ready to share.`);
  }

  const toggle = t.match(/^(?:referral\s+)?code\s+([a-z0-9]{4,20})\s+(on|off)$/i);
  if (toggle) {
    const code = toggle[1]!.toUpperCase();
    const on = toggle[2]!.toLowerCase() === "on";
    if (!(await store.setActive(businessId, code, on))) return `You don't have a code called ${code}. Send *referral* to see yours.`;
    return on ? `*${code}* works again.` : `*${code}* is paused. Businesses can't use it until you send *code ${code} on*.`;
  }
  return null;
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
  async function first(businessId: string) {
    const { data, error } = await db
      .from("promo_codes")
      .select("code, percent_off")
      .eq("referrer_business_id", businessId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`referral code lookup failed: ${error.message}`);
    return data ? { code: data.code as string, percentOff: data.percent_off as number } : null;
  }

  // 23505: the code is already in promo_codes.
  async function insert(businessId: string, code: string) {
    const { error } = await db.from("promo_codes").insert({ code, product: "quote", referrer_business_id: businessId });
    if (error && error.code !== "23505") throw new Error(`referral code failed: ${error.message}`);
    return !error;
  }

  return {
    async codeFor(businessId, businessName) {
      const found = await first(businessId);
      if (found) return found;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (await insert(businessId, newReferralCode(businessName))) return (await first(businessId))!;
      }
      throw new Error("Couldn't find a free referral code after 5 tries");
    },

    async codes(businessId) {
      const { data, error } = await db
        .from("promo_codes")
        .select("code, percent_off, active")
        .eq("referrer_business_id", businessId)
        .order("created_at");
      if (error) throw new Error(`referral codes failed: ${error.message}`);
      if (!data?.length) return [];
      const { data: paid, error: paidError } = await db
        .from("payments")
        .select("promo_code, wa_id")
        .eq("status", "paid")
        .in("promo_code", data.map((c) => c.code));
      if (paidError) throw new Error(`referral count failed: ${paidError.message}`);
      return data.map((c) => ({
        code: c.code as string,
        percentOff: c.percent_off as number,
        active: c.active as boolean,
        used: new Set((paid ?? []).filter((p) => p.promo_code === c.code).map((p) => p.wa_id)).size,
      }));
    },

    async addCode(businessId, code) {
      return (await insert(businessId, code)) ? "added" : "taken";
    },

    async setActive(businessId, code, active) {
      const { data, error } = await db
        .from("promo_codes")
        .update({ active })
        .eq("code", code)
        .eq("referrer_business_id", businessId)
        .select("code");
      if (error) throw new Error(`referral code update failed: ${error.message}`);
      return (data ?? []).length === 1;
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
