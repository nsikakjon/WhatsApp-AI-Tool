import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLink } from "../products/quote/about.js";

// The reminder a partner's ticket holders get the day before the event
// (switched on in the partner package on /dashboard/partners): when it
// starts, where, a map link, and to have their QR code ready.
//
// The rules:
// - Once per partnership, ever. It's marked as sent before anything goes out,
//   so a crash or a second server can't send it twice.
// - Only on the day before the event (Lagos time), 10am to 8pm.
// - Every person holding a ticket that hasn't been let in yet, once each,
//   from the shop's own number.
// - Inside WhatsApp's 24-hour window it's an ordinary message; outside it,
//   WhatsApp only delivers an approved template (EVENT_REMINDER_TEMPLATE_NAME),
//   so without one set up only people who messaged in the last day get it.

export interface DueReminder {
  leadId: number;
  event: string;
  /** "2026-11-28" */
  eventDate: string;
  /** "09:00", or null when the start time wasn't set. */
  eventTime: string | null;
  address: string | null;
  businessId: string;
  /** The number to send from. */
  phoneNumberId: string;
}

export interface ReminderStore {
  /** Agreed partnerships with the reminder on, not yet sent, whose event is on this day. */
  due(eventDate: string): Promise<DueReminder[]>;
  /** Marks it sent. False when another run already did. */
  claim(leadId: number): Promise<boolean>;
  /** WhatsApp numbers of people holding tickets for this shop that haven't been let in. */
  holders(businessId: string): Promise<string[]>;
  /** Records how many it went to. */
  done(leadId: number, sent: number): Promise<void>;
}

export interface ReminderDeps {
  store: ReminderStore;
  canMessageFreely(waId: string, fromNumberId: string): Promise<boolean>;
  sendText(to: string, text: string, fromNumberId: string): Promise<void>;
  /** The approved template, with {{1}} event, {{2}} when, {{3}} where. Leave out when none is set up. */
  sendTemplate?(to: string, params: [string, string, string], fromNumberId: string): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, "error" | "info">;
}

const FIRST_HOUR = 10;
const LAST_HOUR = 20;

/** Lagos date and hour (UTC+1 all year). */
function lagos(now: Date): { date: string; hour: number } {
  const t = new Date(now.getTime() + 3_600_000);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "09:00" -> "9am", "18:30" -> "6:30pm". */
export function clockText(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** "Saturday 28 November at 9am". */
export function whenText(date: string, time: string | null): string {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return time ? `${day} at ${clockText(time)}` : day;
}

export function reminderText(r: Pick<DueReminder, "event" | "eventDate" | "eventTime" | "address">): string {
  const where = r.address ? `\n\nWhere: ${r.address}\nDirections: ${mapLink(r.address)}` : "";
  return `Reminder: *${r.event}* is tomorrow, ${whenText(r.eventDate, r.eventTime)}.${where}\n\nHave your ticket's QR code ready at the door. Can't find it? Send *my tickets* and we'll send it again.`;
}

export interface ReminderResult {
  sent: number;
  skipped: number;
  failed: number;
}

export async function sendDueReminders(deps: ReminderDeps): Promise<ReminderResult> {
  const log = deps.log ?? console;
  const result: ReminderResult = { sent: 0, skipped: 0, failed: 0 };
  const now = lagos(deps.now?.() ?? new Date());
  if (now.hour < FIRST_HOUR || now.hour >= LAST_HOUR) return result;

  for (const r of await deps.store.due(addDays(now.date, 1))) {
    if (!(await deps.store.claim(r.leadId))) continue;
    let sent = 0;
    const text = reminderText(r);
    const params: [string, string, string] = [r.event, whenText(r.eventDate, r.eventTime), r.address ?? "the venue on your ticket"];
    for (const waId of await deps.store.holders(r.businessId)) {
      try {
        if (await deps.canMessageFreely(waId, r.phoneNumberId)) await deps.sendText(waId, text, r.phoneNumberId);
        else if (deps.sendTemplate) await deps.sendTemplate(waId, params, r.phoneNumberId);
        else {
          result.skipped++;
          continue;
        }
        sent++;
      } catch (err) {
        result.failed++;
        log.error(`Event reminder to a ticket holder of ${r.event} failed:`, err);
      }
    }
    result.sent += sent;
    await deps.store.done(r.leadId, sent);
    log.info(`Event reminder for ${r.event}: sent to ${sent}.`);
  }
  return result;
}

export function createSupabaseReminderStore(db: SupabaseClient, mainPhoneNumberId?: string): ReminderStore {
  return {
    async due(eventDate) {
      const { data, error } = await db
        .from("partner_leads")
        .select("id, name, event_date, event_time, business_id, reminder_on, reminder_sent_at, status")
        .eq("status", "Agreed")
        .eq("reminder_on", true)
        .is("reminder_sent_at", null)
        .eq("event_date", eventDate)
        .not("business_id", "is", null);
      if (error) throw new Error(`due reminders failed: ${error.message}`);
      const out: DueReminder[] = [];
      for (const lead of data ?? []) {
        const { data: shop, error: shopError } = await db.from("quote_businesses").select("*").eq("id", lead.business_id).maybeSingle();
        if (shopError) throw new Error(`reminder shop failed: ${shopError.message}`);
        const phoneNumberId = (shop?.phone_number_id as string | null) ?? mainPhoneNumberId;
        if (!shop || !phoneNumberId) continue;
        out.push({
          leadId: Number(lead.id),
          event: lead.name,
          eventDate: lead.event_date,
          eventTime: lead.event_time ? String(lead.event_time).slice(0, 5) : null,
          address: (shop.shop_address as string | null)?.trim() || null,
          businessId: lead.business_id,
          phoneNumberId,
        });
      }
      return out;
    },
    async claim(leadId) {
      const { data, error } = await db
        .from("partner_leads")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", leadId)
        .is("reminder_sent_at", null)
        .select("id");
      if (error) throw new Error(`claim reminder failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async holders(businessId) {
      const { data, error } = await db
        .from("quote_event_tickets")
        .select("quote_orders!inner(contacts(wa_id))")
        .eq("business_id", businessId)
        .is("checked_in_at", null)
        .limit(20_000);
      if (error) throw new Error(`ticket holders failed: ${error.message}`);
      const rows = (data ?? []) as unknown as Array<{ quote_orders: { contacts: { wa_id: string } | null } }>;
      return [...new Set(rows.map((r) => r.quote_orders.contacts?.wa_id).filter((w): w is string => Boolean(w)))];
    },
    async done(leadId, sent) {
      const { error } = await db.from("partner_leads").update({ reminder_sent_count: sent }).eq("id", leadId);
      if (error) throw new Error(`reminder count failed: ${error.message}`);
    },
  };
}
