import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "../../core/i18n.js";
import type { Notice } from "../../core/product.js";
import { lagosHour } from "./followups.js";
import { planLapsed } from "./plan.js";

// Offers built on promo codes (QUOTE_OFFERS, migration 0064).
//
// - LIMITUP: when a business uses up its month's orders or AI replies, the
//   owner's warning offers a discount on the first month of an upgrade.
// - COMEBACK: a business not on a paid plan whose bot has had no customer
//   chats or orders for 30 days gets a win-back code, at most every 90 days.
//
// Both are ordinary rows in promo_codes, so the discount, the number of
// places and on/off are set there (or with "promo LIMITUP on" on WhatsApp),
// never in code. A code that's switched off is never offered. Each owner can
// use each code once, as with any promo code.

export const LIMIT_OFFER_CODE = "LIMITUP";
export const WINBACK_CODE = "COMEBACK";

export interface Offer {
  code: string;
  percentOff: number;
}

/** The code's discount when it's switched on for the quote bot, else null. */
export async function readOffer(db: SupabaseClient, code: string): Promise<Offer | null> {
  const { data, error } = await db.from("promo_codes").select("code, percent_off, active, product").eq("code", code).maybeSingle();
  if (error) throw new Error(`offer lookup failed: ${error.message}`);
  if (!data?.active || (data.product && data.product !== "quote")) return null;
  return { code: data.code as string, percentOff: Number(data.percent_off) };
}

export interface QuietBusiness {
  id: string;
  name: string;
}

export interface WinBackStore {
  /** Live businesses not on a paid plan, at least 30 days old, with no customer chats or orders in 30 days and no win-back in 90. */
  quiet(now: Date): Promise<QuietBusiness[]>;
  /** Marks the win-back as sent; false when another run just did. */
  claim(businessId: string, now: Date): Promise<boolean>;
}

export interface WinBackDeps {
  store: WinBackStore;
  offer(): Promise<Offer | null>;
  /** The cheapest paid plan's name, e.g. "Starter", for the one-tap upgrade. */
  entryPlan(): Promise<string | null>;
  owner(businessId: string): Promise<{ waId: string; fromNumberId?: string; language?: Lang } | null>;
  canMessageFreely(waId: string): Promise<boolean>;
  send(note: Notice, fromNumberId?: string): Promise<void>;
  alertYarnoga(text: string): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const DAY = 86_400_000;

export function winBackNotice(b: QuietBusiness, offer: Offer, plan: string | null, to: string, lang: Lang = "en"): Notice {
  const fr = lang === "fr";
  return {
    to,
    text: "",
    buttons: {
      body: fr
        ? `Bonjour de la part de yarnOga. Le bot de ${b.name} n'a pas eu de clients depuis un mois. Partagez votre numéro sur votre statut WhatsApp et vos réseaux pour relancer les commandes. Si vous voulez plus de commandes, de réponses IA et la livraison, le code *${offer.code}* vous donne ${offer.percentOff} % de réduction sur le premier mois.`
        : `Hi from yarnOga. ${b.name}'s bot hasn't had a customer in a month. Sharing your bot's number on your WhatsApp status and socials is the quickest way to get orders coming again. And if you'd like more orders, AI replies and delivery, code *${offer.code}* gives you ${offer.percentOff}% off your first month.`,
      buttons: [
        ...(plan ? [{ id: `upgrade ${plan.toLowerCase()} ${offer.code}`, title: fr ? `${plan} -${offer.percentOff} %` : `${plan}, ${offer.percentOff}% off` }] : []),
        { id: "plan", title: fr ? "Voir les formules" : "See plans" },
      ],
    },
  };
}

/** Once a day at 11am Lagos time. */
export async function sendWinBacks(deps: WinBackDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? console;
  if (lagosHour(now) !== 11) return;
  const offer = await deps.offer();
  if (!offer) return;
  const plan = await deps.entryPlan();
  for (const b of await deps.store.quiet(now)) {
    try {
      if (!(await deps.store.claim(b.id, now))) continue;
      const owner = await deps.owner(b.id);
      if (owner && (await deps.canMessageFreely(owner.waId))) {
        await deps.send(winBackNotice(b, offer, plan, owner.waId, owner.language), owner.fromNumberId);
      } else {
        await deps.alertYarnoga(
          `${b.name} has had no customer chats or orders for 30 days, and WhatsApp won't let the bot message the owner now. ` +
            `Their win-back code is *${offer.code}* (${offer.percentOff}% off the first month). Owner: ${owner ? `+${owner.waId}` : "no number saved"}.`,
        );
      }
    } catch (err) {
      log.error(`Win-back for ${b.name} failed:`, err);
    }
  }
}

export function createSupabaseWinBacks(db: SupabaseClient, opts: { mainBusinessId: string }): WinBackStore {
  return {
    async quiet(now) {
      const monthAgo = new Date(now.getTime() - 30 * DAY);
      const { data, error } = await db
        .from("quote_businesses")
        .select("*")
        .eq("active", true)
        .not("phone_number_id", "is", null)
        .lt("created_at", monthAgo.toISOString());
      if (error) throw new Error(`quiet businesses failed: ${error.message}`);
      const cutoff = now.getTime() - 90 * DAY;
      const candidates = (data ?? []).filter(
        (r) =>
          r.id !== opts.mainBusinessId &&
          !r.branch_of &&
          (!r.plan_code || r.plan_code === "free" || planLapsed(r, now)) &&
          (!r.winback_sent_at || new Date(r.winback_sent_at as string).getTime() < cutoff),
      );
      const quiet: QuietBusiness[] = [];
      for (const r of candidates) {
        // The owner trying their own bot isn't a customer.
        let chats = db
          .from("messages")
          .select("id, contacts!inner(wa_id)", { count: "exact", head: true })
          .eq("business_number_id", r.phone_number_id)
          .eq("direction", "inbound")
          .gte("created_at", monthAgo.toISOString());
        if (r.owner_wa_id) chats = chats.neq("contacts.wa_id", r.owner_wa_id);
        const [orders, chatCount] = await Promise.all([
          db.from("quote_orders").select("id", { count: "exact", head: true }).eq("business_id", r.id).gte("created_at", monthAgo.toISOString()),
          chats,
        ]);
        if (orders.error) throw new Error(`quiet orders failed: ${orders.error.message}`);
        if (chatCount.error) throw new Error(`quiet chats failed: ${chatCount.error.message}`);
        if ((orders.count ?? 0) === 0 && (chatCount.count ?? 0) === 0) quiet.push({ id: r.id as string, name: r.name as string });
      }
      return quiet;
    },

    async claim(businessId, now) {
      const cutoff = new Date(now.getTime() - 90 * DAY).toISOString();
      const { data, error } = await db
        .from("quote_businesses")
        .update({ winback_sent_at: now.toISOString() })
        .eq("id", businessId)
        .or(`winback_sent_at.is.null,winback_sent_at.lt."${cutoff}"`)
        .select("id");
      if (error) throw new Error(`win-back claim failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
