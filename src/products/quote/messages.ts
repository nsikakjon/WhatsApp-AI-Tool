import type { SupabaseClient } from "@supabase/supabase-js";
import { lagosMonthKey } from "./credits.js";
import type { PlanFeatures } from "./features.js";

// Bot messages: how many WhatsApp messages a business's number has sent this
// month, against its plan's allowance ("bot_messages" in quote_plan_features).
//
// Meta charges for every message after the first 1,000 a month on a number,
// and bills whoever owns the number. So this only applies to numbers yarnOga
// pays for; a number the business connected through the sign-up page
// (whatsapp_connections) is billed to the business by Meta and is never
// limited here.
//
// The database counts the messages (migration 0043). The owner is warned once
// at 80% and once when the allowance is used up. The bot keeps answering
// customers either way: nothing is blocked. A plan without a bot_messages
// cap (today, every plan) is not checked at all.

export interface SentStore {
  /** Messages this number has sent in the month (first day, YYYY-MM-DD). */
  sent(month: string): Promise<number>;
  /** Marks this month's warning as sent; false when it already was, so each goes once. */
  claimWarning(month: string, level: "near" | "full"): Promise<boolean>;
  /** True when the business connected its own number, so Meta bills the business. */
  ownAccount(): Promise<boolean>;
}

export interface MessageAllowance {
  /** A note for the owner at 80% and at 100% of the allowance, once each a month; otherwise null. */
  check(): Promise<string | null>;
  /** A line for the owner's "plan" reply, or null when there is no allowance. */
  summaryLine(): Promise<string | null>;
}

export interface MessageAllowanceOptions {
  features: PlanFeatures;
  store: SentStore;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const WARN_AT = 0.8;

export function createMessageAllowance(opts: MessageAllowanceOptions): MessageAllowance {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;

  async function allowance(): Promise<number | null> {
    const limit = await opts.features.limit("bot_messages");
    if (limit == null || (await opts.store.ownAccount())) return null;
    return limit;
  }

  return {
    async check() {
      try {
        const limit = await allowance();
        if (limit == null) return null;
        const month = lagosMonthKey(now());
        const sent = await opts.store.sent(month);
        if (sent >= limit) {
          if (!(await opts.store.claimWarning(month, "full"))) return null;
          return (
            `Your WhatsApp number has sent all ${limit} bot messages on your plan this month. ` +
            "Your bot is still answering customers. Send *plan* to see your options."
          );
        }
        if (sent >= Math.ceil(limit * WARN_AT) && (await opts.store.claimWarning(month, "near"))) {
          return `Heads-up: your WhatsApp number has sent ${sent} of the ${limit} bot messages on your plan this month. Send *plan* to see your options.`;
        }
        return null;
      } catch (err) {
        log.error("Could not check bot messages:", err);
        return null;
      }
    },

    async summaryLine() {
      try {
        const limit = await allowance();
        if (limit == null) return null;
        return `Bot messages this month: ${await opts.store.sent(lagosMonthKey(now()))} of ${limit}`;
      } catch (err) {
        log.error("Could not read bot messages:", err);
        return null;
      }
    },
  };
}

/**
 * @param numberIds the business's number. For the main number also pass "",
 *   the id messages saved without a number are counted under.
 */
export function createSupabaseSentStore(db: SupabaseClient, numberIds: string[]): SentStore {
  return {
    async sent(month) {
      const { data, error } = await db
        .from("whatsapp_sent_counts")
        .select("sent")
        .in("business_number_id", numberIds)
        .eq("month", month);
      if (error) throw new Error(`Reading whatsapp_sent_counts failed: ${error.message}`);
      return (data ?? []).reduce((sum, row) => sum + Number(row.sent), 0);
    },

    async claimWarning(month, level) {
      const column = level === "near" ? "warned_near" : "warned_full";
      const { data, error } = await db
        .from("whatsapp_sent_counts")
        .update({ [column]: true })
        .eq("business_number_id", numberIds[0])
        .eq("month", month)
        .eq(column, false)
        .select("month");
      if (error) throw new Error(`Updating whatsapp_sent_counts failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async ownAccount() {
      const { count, error } = await db
        .from("whatsapp_connections")
        .select("phone_number_id", { count: "exact", head: true })
        .in("phone_number_id", numberIds.filter(Boolean));
      if (error) throw new Error(`Reading whatsapp_connections failed: ${error.message}`);
      return (count ?? 0) > 0;
    },
  };
}
