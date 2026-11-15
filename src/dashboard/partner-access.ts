import type { SupabaseClient } from "@supabase/supabase-js";
import { esc } from "./page.js";
import type { Partner } from "./partners.js";

// What happens when a partner's event is over, from the last day set on its
// package (migration 0092):
//   until the last day    everything as set up
//   the day after         its keyword on the yarnOga quotes line switches off,
//                         and its organisers see only the event report in the
//                         owner app
//   REPORT_DAYS later     organiser logins stop working
// The shop owner keeps their full app, and the shop's orders, tickets, chats
// and customers are kept throughout.

export const REPORT_DAYS = 30;

export type EventPhase = "on" | "report" | "closed";

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The last day organisers can open the report, e.g. "2026-12-28" for an event ending 28 Nov. */
export const reportUntil = (endsOn: string) => addDays(endsOn, REPORT_DAYS);

/** Where an event is on this Lagos day ("2026-11-29"). No last day set: still on. */
export function eventPhase(endsOn: string | null | undefined, today: string): EventPhase {
  if (!endsOn || today <= endsOn) return "on";
  return today <= reportUntil(endsOn) ? "report" : "closed";
}

export function parseEndForm(form: Record<string, unknown>): { endsOn: string | null } | { problem: string } {
  const value = typeof form.ends_on === "string" ? form.ends_on.trim() : "";
  if (!value) return { endsOn: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return { problem: "Pick the event's last day from the calendar." };
  return { endsOn: value };
}

const longDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function endForm(p: Partner, today: string): string {
  const endsOn = p.endsOn ?? null;
  const phase = eventPhase(endsOn, today);
  const status = !endsOn
    ? "No last day set: the keyword and organiser logins stay on until you set one."
    : phase === "on"
      ? `After ${longDay(endsOn)}, the 0704 keyword switches off and organisers see only the event report, until ${longDay(reportUntil(endsOn))}. Then their logins stop.`
      : phase === "report"
        ? `Event over. Organisers can open the event report until ${longDay(reportUntil(endsOn))}, then their logins stop.`
        : "Event over and the report month has passed: organiser logins are off.";
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/ends">
<h3>When the event ends</h3>
<p class="small wide-all">${esc(status)} The shop owner keeps their full app, and orders, tickets and chats are kept.</p>
<label>Last day of the event <input type="date" name="ends_on" value="${esc(endsOn ?? p.eventDate ?? "")}"></label>
<div class="buttons"><button type="submit">Save last day</button></div>
</form>`;
}

/**
 * Switches off the quotes-line keyword of every partner whose event ended
 * before `today`. Returns how many it switched off. Safe to run often.
 */
export async function endLineKeywords(db: SupabaseClient, today: string): Promise<number> {
  const { data, error } = await db.from("partner_leads").select("business_id").lt("ends_on", today).not("business_id", "is", null);
  if (error) throw new Error(`ended partners failed: ${error.message}`);
  const ids = [...new Set((data ?? []).map((r) => r.business_id as string))];
  if (!ids.length) return 0;
  const { data: cleared, error: clearError } = await db
    .from("quote_businesses")
    // updated_at makes the bots pick the change up straight away.
    .update({ line_keyword: null, updated_at: new Date().toISOString() })
    .in("id", ids)
    .not("line_keyword", "is", null)
    .select("id");
  if (clearError) throw new Error(`switching off ended keywords failed: ${clearError.message}`);
  return (cleared ?? []).length;
}

/** The agreed partnership this shop is for, if any: its last day (null before migration 0092 or when not set). */
export async function findPartnerEvent(db: SupabaseClient, businessId: string): Promise<{ leadId: number; endsOn: string | null } | null> {
  // Every column, so this works before migration 0092 adds ends_on.
  const { data, error } = await db.from("partner_leads").select("*").eq("business_id", businessId).eq("status", "Agreed").limit(1);
  if (error) throw new Error(`partner event lookup failed: ${error.message}`);
  const row = data?.[0];
  return row ? { leadId: Number(row.id), endsOn: (row.ends_on as string | null | undefined) ?? null } : null;
}
