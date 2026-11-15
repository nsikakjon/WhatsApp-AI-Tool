import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../core/money.js";
import { createSupabaseTicketStore } from "../products/quote/tickets/store.js";
import { esc, pageShell, tile } from "./page.js";
import type { PartnerCode } from "./partner-package.js";
import type { Partner } from "./partners.js";

// The event report the partnership letters promise, at
// /dashboard/partners/<id>/report: tickets sold and let in, ticket money,
// how many people chatted to the event's bot and how many replies it sent,
// the reminder, and the discount code. Laid out to print or save as a PDF.

export interface PartnerReport {
  shopName: string | null;
  tickets: Array<{ name: string; sold: number; checkedIn: number }>;
  /** Paid orders with tickets in them. */
  ticketMoneyKobo: number;
  /** Different people who messaged the event's bot. */
  people: number;
  /** Messages the bot (or staff) sent them. */
  replies: number;
  code: PartnerCode | null;
}

export interface ReportSource {
  report(partner: Partner, code: PartnerCode | null): Promise<PartnerReport>;
}

const n = (x: number) => x.toLocaleString("en-GB");

function longDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function renderReport(p: Partner, r: PartnerReport | "error", today: string): string {
  let body: string;
  if (r === "error") {
    body = `<p class="problem">Couldn't put the report together just now. Please try again.</p>`;
  } else {
    const sold = r.tickets.reduce((s, t) => s + t.sold, 0);
    const inside = r.tickets.reduce((s, t) => s + t.checkedIn, 0);
    const rows = r.tickets
      .map((t) => `<tr><td>${esc(t.name)}</td><td>${n(t.sold)}</td><td>${n(t.checkedIn)}</td><td>${t.sold ? `${Math.round((t.checkedIn / t.sold) * 100)}%` : ""}</td></tr>`)
      .join("");
    const reminder =
      p.reminderSentAt != null
        ? `Sent the day before to ${n(p.reminderSentCount ?? 0)} ticket holder${p.reminderSentCount === 1 ? "" : "s"}.`
        : p.reminderOn
          ? "Switched on: it goes out the day before the event."
          : "Not used.";
    body = `<section><h2>${esc(p.name)}</h2>
<p class="intro">${p.eventDate ? esc(longDay(p.eventDate)) : "Event day not set"}${p.place ? ` · ${esc(p.place)}` : ""}${r.shopName ? ` · on yarnOga as ${esc(r.shopName)}` : ""}. Report made ${esc(longDay(today))}.</p>
<div class="tiles">
${tile("Tickets sold", n(sold))}
${tile("Guests let in", n(inside), sold ? `${Math.round((inside / sold) * 100)}% of tickets` : "")}
${tile("Ticket money", formatNaira(r.ticketMoneyKobo), "paid orders with tickets", r.ticketMoneyKobo ? "glow" : "")}
${tile("People who chatted", n(r.people), `${n(r.replies)} replies sent`)}
</div></section>
<section><h2>Tickets</h2>
<table class="plans wide"><thead><tr><th>Ticket</th><th>Sold</th><th>Let in</th><th>Turned up</th></tr></thead><tbody>${
      rows || `<tr><td colspan="4">No tickets sold through yarnOga.</td></tr>`
    }</tbody></table></section>
<section><h2>Reminder</h2><p>${esc(reminder)}</p></section>
<section><h2>Discount code</h2>${
      r.code
        ? `<p><b>${esc(r.code.code)}</b>: ${r.code.percentOff}% off the first month. ${n(r.code.signups)} shop${r.code.signups === 1 ? "" : "s"} signed up with it, ${n(r.code.used)} paid with it.</p>`
        : "<p>No code for this partnership.</p>"
    }</section>
<p class="small">Figures come straight from the database. Ticket money is what customers paid for orders with tickets; Paystack's charges come out of it.</p>`;
  }
  return pageShell({
    title: `${p.name} report`,
    crumb: "Event report",
    heading: "yarn<b>Oga</b> event report",
    nav: `<a href="/dashboard/partners#package-${p.id}">Back to partnerships</a><a href="#" onclick="window.print();return false">Print or save as PDF</a>`,
    body,
    css: `@media print { header nav, .jump { display:none !important; } body { background:#fff; color:#000; } .tile, .plans { border-color:#ccc; background:#fff; } }`,
  });
}

export function createSupabaseReportSource(db: SupabaseClient, mainPhoneNumberId?: string): ReportSource {
  return {
    async report(p, code) {
      if (!p.businessId) return { shopName: null, tickets: [], ticketMoneyKobo: 0, people: 0, replies: 0, code };
      const { data: shop, error } = await db.from("quote_businesses").select("*").eq("id", p.businessId).maybeSingle();
      if (error) throw new Error(`report shop failed: ${error.message}`);
      const tickets = await createSupabaseTicketStore(db, p.businessId).counts(new Date(0));

      const { data: orderRows, error: orderError } = await db.from("quote_event_tickets").select("order_id").eq("business_id", p.businessId).limit(20_000);
      if (orderError) throw new Error(`report ticket orders failed: ${orderError.message}`);
      const orderIds = [...new Set((orderRows ?? []).map((r) => r.order_id as string))];
      let ticketMoneyKobo = 0;
      for (let i = 0; i < orderIds.length; i += 200) {
        const { data, error: moneyError } = await db.from("quote_orders").select("total_kobo").in("id", orderIds.slice(i, i + 200));
        if (moneyError) throw new Error(`report ticket money failed: ${moneyError.message}`);
        ticketMoneyKobo += (data ?? []).reduce((s, o) => s + Number(o.total_kobo), 0);
      }

      let people = 0;
      let replies = 0;
      const numberId = (shop?.phone_number_id as string | null) ?? mainPhoneNumberId;
      // The main number's chats are everyone's, so they only count for a shop with its own number.
      if (numberId && shop?.phone_number_id) {
        const { data: inbound, error: inError } = await db
          .from("messages")
          .select("contact_id")
          .eq("business_number_id", numberId)
          .eq("direction", "inbound")
          .limit(50_000);
        if (inError) throw new Error(`report chats failed: ${inError.message}`);
        people = new Set((inbound ?? []).map((m) => m.contact_id as string)).size;
        const { count, error: outError } = await db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("business_number_id", numberId)
          .eq("direction", "outbound");
        if (outError) throw new Error(`report replies failed: ${outError.message}`);
        replies = count ?? 0;
      }
      return { shopName: (shop?.name as string | null) ?? null, tickets, ticketMoneyKobo, people, replies, code };
    },
  };
}
