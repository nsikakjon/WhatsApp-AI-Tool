import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "../../core/i18n.js";
import type { Notice } from "../../core/product.js";
import { lagosHour } from "./followups.js";
import { planLapsed } from "./plan.js";

// Usage drop warnings (QUOTE_USAGE_DROP_ALERTS, migration 0064).
//
// Once a day, each paying business's last 30 days are compared with the 30
// before. If its orders or its customer chats fell by 40% or more, yarnOga
// gets a WhatsApp alert, so someone can call before the owner stops paying.
// With QUOTE_USAGE_DROP_CHECKIN, the owner also gets a short check-in from
// their bot with "All good" and "Please call me" buttons.
//
// Small numbers swing a lot, so a business needs at least 10 orders or 20
// chats in the earlier month to count. Each business is flagged at most once
// every 30 days.

export interface PayingBusiness {
  id: string;
  name: string;
  planName: string;
  /** The WhatsApp number its customers message, for counting chats. */
  numberId: string | null;
}

export interface Usage {
  orders: number;
  chats: number;
}

export interface UsageDropStore {
  /** Businesses on a paid plan that hasn't lapsed, not flagged in the last 30 days. */
  paying(now: Date): Promise<PayingBusiness[]>;
  usage(b: PayingBusiness, from: Date, to: Date): Promise<Usage>;
  /** Marks the business as flagged now; false when another run just did. */
  claim(businessId: string, now: Date): Promise<boolean>;
}

export interface UsageDropDeps {
  store: UsageDropStore;
  alertYarnoga(text: string): Promise<void>;
  /** With QUOTE_USAGE_DROP_CHECKIN: the owner, if the bot can message them now. */
  checkIn?: {
    owner(businessId: string): Promise<{ waId: string; fromNumberId?: string; language?: Lang } | null>;
    canMessageFreely(waId: string): Promise<boolean>;
    send(note: Notice, fromNumberId?: string): Promise<void>;
  };
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const DAY = 86_400_000;
const MIN_ORDERS = 10;
const MIN_CHATS = 20;
/** Checked at 10am Lagos time. */
const HOUR = 10;

export const CHECK_IN_OK = "yarnoga all good";
export const CHECK_IN_CALL = "yarnoga call me";

/** What fell by 40% or more, e.g. ["orders"]; empty when nothing did. */
export function droppedBy40(before: Usage, now: Usage): Array<keyof Usage> {
  const fell = (was: number, is: number, min: number) => was >= min && is * 10 <= was * 6;
  return [
    ...(fell(before.orders, now.orders, MIN_ORDERS) ? (["orders"] as const) : []),
    ...(fell(before.chats, now.chats, MIN_CHATS) ? (["chats"] as const) : []),
  ];
}

const percent = (was: number, is: number) => Math.round(((was - is) * 100) / was);

export function dropAlert(b: PayingBusiness, before: Usage, now: Usage, owner: string | null): string {
  const line = (what: string, was: number, is: number) =>
    `• ${is} ${what} in the last 30 days, ${was > 0 ? `down from ${was} (-${percent(was, is)}%)` : "none the month before"}`;
  return [
    `${b.name} (${b.planName}) has gone quiet:`,
    line("orders", before.orders, now.orders),
    line("customer chats", before.chats, now.chats),
    `Owner: ${owner ? `+${owner}` : "no number saved"}. Worth a call before they think about cancelling.`,
  ].join("\n");
}

export function checkInNotice(b: PayingBusiness, to: string, lang: Lang = "en"): Notice {
  const fr = lang === "fr";
  return {
    to,
    text: "",
    buttons: {
      body: fr
        ? `Bonjour de la part de yarnOga. Votre bot reçoit moins de commandes et de messages que le mois dernier pour ${b.name}. Tout va bien ? Si quelque chose ne marche pas, on vous appelle.`
        : `Hi from yarnOga. Your bot has had fewer orders and chats for ${b.name} than last month. Is everything OK? If something isn't working, we'll call you.`,
      buttons: [
        { id: CHECK_IN_OK, title: fr ? "Tout va bien" : "All good" },
        { id: CHECK_IN_CALL, title: fr ? "Appelez-moi" : "Please call me" },
      ],
    },
  };
}

export async function checkUsageDrops(deps: UsageDropDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? console;
  if (lagosHour(now) !== HOUR) return;
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const twoMonthsAgo = new Date(now.getTime() - 60 * DAY);
  for (const b of await deps.store.paying(now)) {
    try {
      const [before, recent] = await Promise.all([deps.store.usage(b, twoMonthsAgo, monthAgo), deps.store.usage(b, monthAgo, now)]);
      if (droppedBy40(before, recent).length === 0) continue;
      if (!(await deps.store.claim(b.id, now))) continue;
      const owner = deps.checkIn ? await deps.checkIn.owner(b.id) : null;
      await deps.alertYarnoga(dropAlert(b, before, recent, owner?.waId ?? null));
      if (owner && (await deps.checkIn!.canMessageFreely(owner.waId))) {
        await deps.checkIn!.send(checkInNotice(b, owner.waId, owner.language), owner.fromNumberId);
      }
    } catch (err) {
      log.error(`Usage drop check for ${b.name} failed:`, err);
    }
  }
}

export function createSupabaseUsageDrops(db: SupabaseClient, opts: { mainBusinessId: string; mainNumberId: string }): UsageDropStore {
  return {
    async paying(now) {
      const { data, error } = await db.from("quote_businesses").select("*").not("plan_code", "is", null).neq("plan_code", "free");
      if (error) throw new Error(`paying businesses failed: ${error.message}`);
      const cutoff = now.getTime() - 30 * DAY;
      const rows = (data ?? []).filter(
        (r) =>
          !r.branch_of &&
          (r.active || r.id === opts.mainBusinessId) &&
          !planLapsed(r, now) &&
          (!r.usage_drop_alerted_at || new Date(r.usage_drop_alerted_at as string).getTime() < cutoff),
      );
      if (rows.length === 0) return [];
      const { data: plans, error: planError } = await db.from("quote_plans").select("code, name");
      if (planError) throw new Error(`plans failed: ${planError.message}`);
      const names = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]));
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        planName: names.get(r.plan_code as string) ?? (r.plan_code as string),
        numberId: r.id === opts.mainBusinessId ? opts.mainNumberId : ((r.phone_number_id as string | null) ?? null),
      }));
    },

    async usage(b, from, to) {
      const orders = await db
        .from("quote_orders")
        .select("id", { count: "exact", head: true })
        .eq("business_id", b.id)
        .gte("confirmed_at", from.toISOString())
        .lt("confirmed_at", to.toISOString());
      if (orders.error) throw new Error(`usage orders failed: ${orders.error.message}`);
      let chats = 0;
      if (b.numberId) {
        const { data, error } = await db
          .from("messages")
          .select("contact_id")
          .eq("business_number_id", b.numberId)
          .eq("direction", "inbound")
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString())
          .limit(20_000);
        if (error) throw new Error(`usage chats failed: ${error.message}`);
        chats = new Set((data ?? []).map((r) => r.contact_id as string)).size;
      }
      return { orders: orders.count ?? 0, chats };
    },

    async claim(businessId, now) {
      const cutoff = new Date(now.getTime() - 30 * DAY).toISOString();
      const { data, error } = await db
        .from("quote_businesses")
        .update({ usage_drop_alerted_at: now.toISOString() })
        .eq("id", businessId)
        .or(`usage_drop_alerted_at.is.null,usage_drop_alerted_at.lt."${cutoff}"`)
        .select("id");
      if (error) throw new Error(`usage drop claim failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
