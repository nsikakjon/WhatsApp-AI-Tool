import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../money.js";
import type { AppliedPromo, RefusedPromo } from "./payments.js";

// Promo codes such as DAYONES (migration 0041). A code takes a percentage off
// the first month of a payment, for its first max_uses people, once each.
// Payers type it at the end of an upgrade message; the discount is worked out
// when the payment is saved (create_promo_payment), never by the AI.
//
// The owner switches codes on and off and changes how many people can use them
// from WhatsApp ("promo DAYONES off", "promo DAYONES limit 20"), or on the
// code's row in Supabase.

/**
 * "upgrade standard DAYONES" -> "upgrade standard" and "DAYONES". The last
 * word is only taken as a code when the message isn't a command without it.
 */
export function takePromoCode(text: string, isCommand: (text: string) => boolean): { text: string; code?: string } {
  if (isCommand(text)) return { text };
  const m = text.match(/^(.+?)\s+(?:(?:with|using)\s+)?(?:(?:promo|referral|discount)\s+)?(?:code\s+)?([a-z0-9]{4,20})$/i);
  return m && isCommand(m[1]!) ? { text: m[1]!, code: m[2]!.toUpperCase() } : { text };
}

export function promoAppliedText(promo: AppliedPromo): string {
  return `Code *${promo.code}*: ${promo.percentOff}% off your first month, so you save ${formatNaira(promo.amountOffKobo)}.`;
}

export function promoRefusedText(refused: RefusedPromo): string {
  const fullPrice = "Send the same message without the code to pay the full price.";
  switch (refused.result) {
    case "own":
      return `*${refused.code}* is your own referral code, so it can't be used on your payment. Share it with other businesses instead.`;
    case "used":
      return `You've already used *${refused.code}*, and each code works once per person. ${fullPrice}`;
    case "full":
      return `Sorry, *${refused.code}* was for the first ${refused.maxUses} subscribers and those places have all gone. ${fullPrice}`;
    default:
      return `*${refused.code}* isn't a code I recognise, or it has ended. Please check the spelling. ${fullPrice}`;
  }
}

export interface PromoUsage {
  code: string;
  percentOff: number;
  maxUses: number | null;
  active: boolean;
  product: string | null;
  /** Different people who have paid with it. */
  used: number;
  /** People holding a place with a link they haven't paid yet (held for a day). */
  waiting: number;
}

export interface PromoAdmin {
  /** Promo codes with how much they've been used. Businesses' referral codes aren't listed. */
  codes(): Promise<PromoUsage[]>;
  /** False when there's no such code. */
  update(code: string, change: { active?: boolean; maxUses?: number | null }): Promise<boolean>;
}

const HOLD_MS = 24 * 60 * 60 * 1000;

function usageLine(p: PromoUsage): string {
  const on = p.active ? "on" : "OFF";
  const where = p.product ? `, ${p.product} only` : "";
  const uses =
    p.maxUses == null ? `${p.used} used, no limit` : `${p.used} of ${p.maxUses} used, ${Math.max(p.maxUses - p.used - p.waiting, 0)} left`;
  const waiting = p.waiting ? ` (${p.waiting} more holding an unpaid link)` : "";
  return `*${p.code}*: ${p.percentOff}% off the first month${where}, ${on}. ${uses}${waiting}.`;
}

const HOW =
  "Send *promo DAYONES off* (or *on*) to switch a code off or on, and *promo DAYONES limit 20* to change how many people can use it (*limit none* for no limit).";

/** The owner's promo commands. Null when the message isn't one. */
export async function promoCommand(admin: PromoAdmin, text: string): Promise<string | null> {
  const t = text.trim();
  if (/^(promos?|promo codes|codes)$/i.test(t)) {
    const codes = await admin.codes();
    return codes.length ? `${codes.map(usageLine).join("\n")}\n\n${HOW}` : "There are no promo codes yet.";
  }
  const change = t.match(/^promo\s+([a-z0-9]{4,20})\s+(on|off|limit\s+(\d{1,6}|none|no limit|unlimited))$/i);
  if (!change) return /^promo\s/i.test(t) ? HOW : null;
  const code = change[1]!.toUpperCase();
  const what = change[2]!.toLowerCase();
  const limit = change[3]?.toLowerCase();
  const update = what === "on" || what === "off" ? { active: what === "on" } : { maxUses: limit && /^\d+$/.test(limit) ? Number(limit) : null };
  if (!(await admin.update(code, update))) return `There's no promo code called ${code}. Send *promos* to see them.`;
  const now = (await admin.codes()).find((p) => p.code === code);
  return now ? `Done. ${usageLine(now)}` : "Done.";
}

export function createSupabasePromoAdmin(db: SupabaseClient, now: () => Date = () => new Date()): PromoAdmin {
  return {
    async codes() {
      const { data: codes, error } = await db
        .from("promo_codes")
        .select("code, percent_off, max_uses, active, product")
        .is("referrer_business_id", null)
        .order("created_at");
      if (error) throw new Error(`promo codes failed: ${error.message}`);
      if (!codes?.length) return [];
      const { data: payments, error: payError } = await db
        .from("payments")
        .select("promo_code, wa_id, status, created_at")
        .in("promo_code", codes.map((c) => c.code));
      if (payError) throw new Error(`promo payments failed: ${payError.message}`);
      const since = now().getTime() - HOLD_MS;
      return codes.map((c) => {
        const mine = (payments ?? []).filter((p) => p.promo_code === c.code);
        const paid = new Set(mine.filter((p) => p.status === "paid").map((p) => p.wa_id));
        const waiting = new Set(
          mine.filter((p) => p.status === "pending" && !paid.has(p.wa_id) && new Date(p.created_at).getTime() > since).map((p) => p.wa_id),
        );
        return {
          code: c.code,
          percentOff: c.percent_off,
          maxUses: c.max_uses,
          active: c.active,
          product: c.product,
          used: paid.size,
          waiting: waiting.size,
        };
      });
    },

    async update(code, change) {
      const row: Record<string, unknown> = {};
      if (change.active !== undefined) row.active = change.active;
      if (change.maxUses !== undefined) row.max_uses = change.maxUses;
      const { data, error } = await db.from("promo_codes").update(row).eq("code", code).select("code");
      if (error) throw new Error(`promo update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
