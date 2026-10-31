import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import type { PaymentLinks } from "../../core/payments/payments.js";
import type { Payment } from "../../core/payments/store.js";
import { lagosMonthKey } from "./credits.js";
import type { PlanFeatures } from "./features.js";

// AI reply top-ups (QUOTE_AI_TOPUPS, migration 0063). A business that has
// used, or is close to using, its plan's AI replies for the month can buy a
// pack of extra replies by Paystack link instead of upgrading.
//
// Packs and prices are rows in quote_ai_packs (kobo), never code. Extra
// replies count for the Lagos month they're paid in and end with it. Each
// paid pack is saved under its Paystack reference, so a retried webhook
// never adds it twice. Packs are in naira.

export interface AiPack {
  code: string;
  name: string;
  replies: number;
  priceKobo: number;
}

export interface TopUpStore {
  /** Packs on sale, smallest first. */
  packs(): Promise<AiPack[]>;
  /** Replies bought for this month (first day, YYYY-MM-DD). */
  extra(month: string): Promise<number>;
  /** AI replies used this month. */
  used(month: string): Promise<number>;
}

export interface TopUpLedger {
  /** Saves a paid pack; false when this reference was already saved. */
  add(t: { reference: string; businessId: string; month: string; packCode: string; replies: number; amountKobo: number; planLimit: number }): Promise<boolean>;
}

export interface TopUps {
  extra(month: string): Promise<number>;
  packs(): Promise<AiPack[]>;
  /** A payment link for a pack, or null when the plan has no AI reply cap to top up. */
  link(packCode: string, waId: string): Promise<{ url: string; pack: AiPack } | null>;
  /** The owner's "top up" or "top up 1000" on WhatsApp; null for any other message. */
  ownerCommand(text: string, ownerWaId: string): Promise<string | null>;
  /** A line for the owner's "plan" reply, or null when the plan has no AI reply cap. */
  summaryLine(): Promise<string | null>;
}

export interface TopUpsOptions {
  /** The business the replies are counted under (a branch uses its main business). */
  businessId: string;
  features: PlanFeatures;
  store: TopUpStore;
  links: PaymentLinks;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const COMMAND = /^(?:top ?up|buy (?:more )?(?:ai )?replies)(?:\s+([\d,]+))?(?:\s+replies)?$/i;

const n = (x: number) => x.toLocaleString("en-NG");

/** "31 October" for the month that starts on this day. */
function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function createTopUps(opts: TopUpsOptions): TopUps {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;

  /** The plan's AI replies a month, or null when there's no cap (nothing to top up). */
  async function planLimit(): Promise<number | null> {
    if (!(await opts.features.has("ai_credits"))) return null;
    return opts.features.limit("ai_credits");
  }

  async function link(packCode: string, waId: string) {
    if ((await planLimit()) == null) return null;
    const pack = (await opts.store.packs()).find((p) => p.code === packCode);
    if (!pack) return null;
    const made = await opts.links.createLink({
      product: "quote",
      waId,
      amountKobo: pack.priceKobo,
      purpose: { kind: "ai_topup", businessId: opts.businessId, pack: pack.code, replies: pack.replies },
      title: `yarnOga ${pack.name}`,
    });
    if (!made.url) throw new Error("No payment link was made");
    return { url: made.url, pack };
  }

  return {
    extra: (month) => opts.store.extra(month),
    packs: () => opts.store.packs(),
    link,

    async ownerCommand(text, ownerWaId) {
      const asked = text.trim().match(COMMAND);
      if (!asked) return null;
      try {
        if ((await planLimit()) == null) return "Your plan has no limit on AI replies, so there's nothing to top up.";
        const packs = await opts.store.packs();
        if (packs.length === 0) return "There are no AI reply packs on sale just now. Send *plan* to see how to upgrade.";
        const wanted = asked[1] ? Number(asked[1].replace(/,/g, "")) : null;
        const pack = packs.length === 1 && wanted == null ? packs[0] : packs.find((p) => p.replies === wanted);
        if (!pack) {
          return [
            "AI reply packs (added to this month, used by the last day):",
            ...packs.map((p) => `• ${n(p.replies)} replies: ${formatNaira(p.priceKobo)}. Send *top up ${p.replies}*`),
            "",
            "Need more every month? Send *plan* to see the plans.",
          ].join("\n");
        }
        const made = await link(pack.code, ownerWaId);
        if (!made) return null;
        return [
          `Here's your payment link for ${n(pack.replies)} extra AI replies (${formatNaira(pack.priceKobo)}):`,
          made.url,
          "",
          `They're added as soon as the payment goes through, to use by ${lastDayOf(lagosMonthKey(now()))}.`,
        ].join("\n");
      } catch (err) {
        log.error("Could not make an AI top-up link:", err);
        return "Sorry, I couldn't make a payment link just now. Please try again later.";
      }
    },

    async summaryLine() {
      try {
        const limit = await planLimit();
        if (limit == null) return null;
        const month = lagosMonthKey(now());
        const [used, extra] = await Promise.all([opts.store.used(month), opts.store.extra(month)]);
        const shown = Math.min(used, limit + extra);
        const bought = extra ? ` (${n(limit)} on your plan + ${n(extra)} topped up)` : "";
        return `AI replies this month: ${n(shown)} of ${n(limit + extra)}${bought}. Send *top up* for more.`;
      } catch (err) {
        log.error("Could not read AI replies:", err);
        return null;
      }
    },
  };
}

/**
 * What happens once a pack is paid: the replies are added to the month it's
 * paid in. Returns the owner's thank-you, or null when this payment was
 * already counted.
 */
export function createTopUpPaidHandler(opts: {
  ledger: TopUpLedger;
  /** The business's plan AI replies a month (0 when it has none). */
  planLimit(businessId: string): Promise<number>;
  now?: () => Date;
}): (payment: Payment) => Promise<string | null> {
  const now = opts.now ?? (() => new Date());
  return async (payment) => {
    const { businessId, pack, replies } = payment.purpose as { businessId?: unknown; pack?: unknown; replies?: unknown };
    if (typeof businessId !== "string" || typeof pack !== "string" || !Number.isInteger(replies) || (replies as number) < 1) {
      throw new Error(`Payment ${payment.reference} is a top-up we can't read: ${JSON.stringify(payment.purpose)}`);
    }
    const month = lagosMonthKey(now());
    const added = await opts.ledger.add({
      reference: payment.reference,
      businessId,
      month,
      packCode: pack,
      replies: replies as number,
      amountKobo: payment.amountKobo,
      planLimit: await opts.planLimit(businessId),
    });
    if (!added) return null;
    return `✅ Payment of ${formatNaira(payment.amountKobo)} received, thank you. ${n(replies as number)} extra AI replies are added, to use by ${lastDayOf(month)}.`;
  };
}

export function createSupabaseTopUpStore(db: SupabaseClient, businessId: string): TopUpStore {
  return {
    async packs() {
      const { data, error } = await db.from("quote_ai_packs").select("code, name, replies, price_kobo").eq("active", true).order("sort_order").order("replies");
      if (error) throw new Error(`AI packs failed: ${error.message}`);
      return (data ?? []).map((r) => ({ code: r.code as string, name: r.name as string, replies: Number(r.replies), priceKobo: Number(r.price_kobo) }));
    },
    async extra(month) {
      const { data, error } = await db.from("quote_ai_topups").select("replies").eq("business_id", businessId).eq("month", month);
      if (error) throw new Error(`AI top-ups failed: ${error.message}`);
      return (data ?? []).reduce((sum, r) => sum + Number(r.replies), 0);
    },
    async used(month) {
      const { data, error } = await db.from("quote_ai_usage").select("credits_used").eq("business_id", businessId).eq("month", month).maybeSingle();
      if (error) throw new Error(`AI replies used failed: ${error.message}`);
      return Number(data?.credits_used ?? 0);
    },
  };
}

export function createSupabaseTopUpLedger(db: SupabaseClient): TopUpLedger {
  return {
    async add(t) {
      const { data, error } = await db.rpc("quote_add_ai_topup", {
        p_reference: t.reference,
        p_business_id: t.businessId,
        p_month: t.month,
        p_pack_code: t.packCode,
        p_replies: t.replies,
        p_amount_kobo: t.amountKobo,
        p_plan_limit: t.planLimit,
      });
      if (error) throw new Error(`quote_add_ai_topup failed: ${error.message}`);
      return data === true;
    },
  };
}
