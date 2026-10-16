import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import { DEFAULT_BUSINESS_ID } from "./store.js";

// Quote follow-ups ("abandoned cart" for quotes). When a customer got a quote
// but never said YES, the bot sends them one polite reminder after a set time
// (next day by default). Switched off unless QUOTE_FOLLOW_UPS is on.
//
// The rules:
// - One reminder per quote, ever. The quote is marked before the reminder is
//   sent, so a crash or a second server can't send it twice.
// - Only for quotes still waiting for a YES: confirmed, paid and cancelled
//   quotes never get one.
// - Never to a customer who has messaged us since the quote (they're already
//   talking to us), who replied STOP, or whose chat staff have taken over.
// - Inside WhatsApp's 24-hour window it's an ordinary message; outside it,
//   WhatsApp only delivers an approved template, so without one set up the
//   reminder is skipped.
// - Only sent in the daytime, Lagos time, never in the middle of the night.
// - The amount comes from the saved quote in the database, never from the AI.

/** A quote that may be due a reminder. */
export interface DueQuote {
  id: string;
  orderNumber: number;
  totalKobo: number;
  contactId: string;
  customerWaId: string;
  customerName: string | null;
  createdAt: Date;
}

export interface FollowUpStore {
  /**
   * Quotes still waiting for a YES whose reminder hasn't been decided yet,
   * made between `createdAfter` and `createdBefore`, oldest first. Leave
   * `businessId` out to read every quote without looking at businesses
   * (business #1 while QUOTE_MULTI_BUSINESS is off).
   */
  dueQuotes(businessId: string | undefined, createdAfter: Date, createdBefore: Date, limit: number): Promise<DueQuote[]>;
  /**
   * Records what happened to a quote's reminder. Returns false if that was
   * already decided or the quote is no longer waiting for a YES, in which
   * case nothing must be sent.
   */
  decide(orderId: string, status: "sent" | "skipped"): Promise<boolean>;
  /** Notes that WhatsApp refused a reminder that was marked sent. */
  markFailed(orderId: string): Promise<void>;
  optedOut(businessId: string, contactId: string): Promise<boolean>;
  /** The customer replied STOP: no more reminders from this business. */
  optOut(businessId: string, contactId: string): Promise<void>;
  /** Each business's own reminder delay in hours (null = use the default, 0 = off). */
  businessHours(): Promise<Map<string, number | null>>;
}

/** One business whose quotes get reminders. */
export interface FollowUpTarget {
  /** Leave out for business #1 while QUOTE_MULTI_BUSINESS is off. */
  businessId?: string;
  businessName: string;
  orderPrefix: string;
  /** Hours after the quote before the reminder goes. */
  hours: number;
  /** Which of our WhatsApp numbers to send from. Leave out for the main number. */
  phoneNumberId?: string;
}

export interface FollowUpDeps {
  store: FollowUpStore;
  /** When this person last messaged us, or null if never. */
  lastInboundAt(waId: string): Promise<Date | null>;
  /** True while we may still send them ordinary messages (24-hour window). */
  canMessageFreely(waId: string): Promise<boolean>;
  /** True while staff have taken over this chat (inbox or a reply from the phone app). */
  isPaused(contactId: string, phoneNumberId?: string): Promise<boolean>;
  /** Whether the business's plan includes follow-ups. Leave out to allow every business. */
  allowed?(businessId: string): Promise<boolean>;
  sendText(to: string, text: string, fromNumberId?: string): Promise<void>;
  /** Sends the approved reminder template. Leave out when no template is set up. */
  sendTemplate?(to: string, params: string[], fromNumberId?: string): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

export interface FollowUpResult {
  sent: number;
  skipped: number;
  failed: number;
}

/** Reminders are only sent from 8am to 8pm Lagos time; ones due at night wait for the morning. */
const FIRST_HOUR = 8;
const LAST_HOUR = 20;
/** Quotes older than their reminder time plus this are left alone (e.g. when follow-ups are first switched on). */
const MAX_LATE_MS = 48 * 60 * 60 * 1000;
/** At most this many reminders per business each run. */
const BATCH = 50;

/** The hour (0-23) in Lagos, which is always UTC+1. */
export function lagosHour(at: Date): number {
  return (at.getUTCHours() + 1) % 24;
}

/** The ordinary-message reminder, used inside the 24-hour window. */
export function followUpText(target: FollowUpTarget, quote: DueQuote): string {
  const name = quote.customerName?.trim() ? ` ${quote.customerName.trim()}` : "";
  return [
    `Hi${name}, just checking in on your quote ${target.orderPrefix}-${quote.orderNumber} from ${target.businessName} (total ${formatNaira(quote.totalKobo)}).`,
    "",
    "Reply YES to place the order, or tell me what you'd like to change.",
    "Reply STOP if you'd rather not get reminders.",
  ].join("\n");
}

/** Values for the template's {{1}} name, {{2}} business, {{3}} quote number and {{4}} total. */
export function followUpTemplateParams(target: FollowUpTarget, quote: DueQuote): string[] {
  return [
    quote.customerName?.trim() || "there",
    target.businessName,
    `${target.orderPrefix}-${quote.orderNumber}`,
    formatNaira(quote.totalKobo),
  ];
}

/** Sends the reminders that are due for one business. */
export async function sendDueFollowUps(target: FollowUpTarget, deps: FollowUpDeps): Promise<FollowUpResult> {
  const result: FollowUpResult = { sent: 0, skipped: 0, failed: 0 };
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? console;
  const businessId = target.businessId ?? DEFAULT_BUSINESS_ID;

  if (target.hours <= 0) return result;
  const hour = lagosHour(now);
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return result;
  if (deps.allowed && !(await deps.allowed(businessId))) return result;

  const dueBefore = new Date(now.getTime() - target.hours * 60 * 60 * 1000);
  const dueAfter = new Date(dueBefore.getTime() - MAX_LATE_MS);
  const quotes = await deps.store.dueQuotes(target.businessId, dueAfter, dueBefore, BATCH);

  for (const quote of quotes) {
    const label = `${target.orderPrefix}-${quote.orderNumber}`;
    try {
      const skip = async () => {
        if (await deps.store.decide(quote.id, "skipped")) result.skipped++;
      };

      // They've messaged us since the quote, so they're already talking to us.
      const last = await deps.lastInboundAt(quote.customerWaId);
      if (last && last > quote.createdAt) {
        await skip();
        continue;
      }
      if (await deps.store.optedOut(businessId, quote.contactId)) {
        await skip();
        continue;
      }
      if (await deps.isPaused(quote.contactId, target.phoneNumberId)) {
        await skip();
        continue;
      }

      const free = await deps.canMessageFreely(quote.customerWaId);
      if (!free && !deps.sendTemplate) {
        await skip();
        continue;
      }

      // Mark it first: if this fails or another server got there first, nothing is sent.
      if (!(await deps.store.decide(quote.id, "sent"))) continue;
      try {
        if (free) await deps.sendText(quote.customerWaId, followUpText(target, quote), target.phoneNumberId);
        else await deps.sendTemplate!(quote.customerWaId, followUpTemplateParams(target, quote), target.phoneNumberId);
        result.sent++;
      } catch (err) {
        log.error(`Could not send the reminder for quote ${label}:`, err);
        result.failed++;
        await deps.store.markFailed(quote.id);
      }
    } catch (err) {
      log.error(`Could not check quote ${label} for a reminder:`, err);
    }
  }
  return result;
}

/** True for a message asking us to stop sending reminders. */
export function isStopRequest(text: string | undefined): boolean {
  return /^\s*(stop|unsubscribe|stop reminders?|no more reminders?)\s*[.!]*\s*$/i.test(text ?? "");
}

export function createSupabaseFollowUps(db: SupabaseClient): FollowUpStore {
  return {
    async dueQuotes(businessId, createdAfter, createdBefore, limit) {
      let query = db
        .from("quote_orders")
        .select("id, order_number, total_kobo, contact_id, created_at, contacts(wa_id, name)")
        .eq("status", "quoted")
        .is("follow_up_status", null)
        .gte("created_at", createdAfter.toISOString())
        .lte("created_at", createdBefore.toISOString());
      if (businessId) query = query.eq("business_id", businessId);
      const { data, error } = await query.order("created_at").limit(limit);
      if (error) throw new Error(`dueQuotes failed: ${error.message}`);
      return (data ?? []).map((row) => {
        const contact = row.contacts as unknown as { wa_id: string; name: string | null };
        return {
          id: row.id as string,
          orderNumber: Number(row.order_number),
          totalKobo: Number(row.total_kobo),
          contactId: row.contact_id as string,
          customerWaId: contact.wa_id,
          customerName: contact.name,
          createdAt: new Date(row.created_at as string),
        };
      });
    },

    async decide(orderId, status) {
      const { data, error } = await db
        .from("quote_orders")
        .update({ follow_up_status: status, follow_up_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("status", "quoted")
        .is("follow_up_status", null)
        .select("id");
      if (error) throw new Error(`follow-up decide failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async markFailed(orderId) {
      const { error } = await db.from("quote_orders").update({ follow_up_status: "failed" }).eq("id", orderId);
      if (error) throw new Error(`follow-up markFailed failed: ${error.message}`);
    },

    async optedOut(businessId, contactId) {
      const { data, error } = await db
        .from("quote_follow_up_opt_outs")
        .select("contact_id")
        .eq("business_id", businessId)
        .eq("contact_id", contactId)
        .maybeSingle();
      if (error) throw new Error(`optedOut failed: ${error.message}`);
      return data !== null;
    },

    async optOut(businessId, contactId) {
      const { error } = await db
        .from("quote_follow_up_opt_outs")
        .upsert({ business_id: businessId, contact_id: contactId }, { onConflict: "contact_id,business_id", ignoreDuplicates: true });
      if (error) throw new Error(`optOut failed: ${error.message}`);
    },

    async businessHours() {
      const { data, error } = await db.from("quote_businesses").select("id, follow_up_hours");
      if (error) throw new Error(`follow-up hours lookup failed: ${error.message}`);
      return new Map((data ?? []).map((row) => [row.id as string, (row.follow_up_hours as number | null) ?? null]));
    },
  };
}
