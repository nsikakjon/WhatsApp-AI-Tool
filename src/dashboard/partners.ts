import type { SupabaseClient } from "@supabase/supabase-js";
import { esc, pageShell, tile } from "./page.js";

// The partnerships list at /dashboard/partners: events, fairs and organisers
// we pitch in-kind partnerships to, how far each one has got, and when to
// follow up.

export const STATUSES = ["To contact", "Sent", "Replied", "Meeting", "Agreed", "Declined", "No reply"] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses that need nothing more from us. */
const CLOSED: Status[] = ["Agreed", "Declined"];

/** Days after sending to chase a proposal when no follow-up day is picked. */
export const FOLLOW_UP_AFTER_DAYS = 5;

export const KINDS = ["Festival", "Market or fair", "Campus", "TEDx", "Conference", "Government", "Other"];

export interface NewPartner {
  name: string;
  kind: string | null;
  /** "2026-12-19", or null when the date isn't known yet. */
  eventDate: string | null;
  place: string | null;
  /** Who to reach and how: a name, email, phone or social handle. */
  contact: string | null;
  offer: string | null;
  status: Status;
  sentOn: string | null;
  followUpOn: string | null;
  link: string | null;
  notes: string | null;
}

export interface Partner extends NewPartner {
  id: number;
}

export interface PartnerStore {
  list(): Promise<Partner[]>;
  add(p: NewPartner): Promise<void>;
  update(id: number, p: NewPartner): Promise<void>;
  remove(id: number): Promise<void>;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Turns the add or edit form into a partner, or explains what's wrong. Marking
 * one Sent fills in today as the day sent, and a follow-up day a few days
 * later, unless they were typed in.
 */
export function parsePartnerForm(form: Record<string, unknown>, today: string): NewPartner | { problem: string } {
  const text = (name: string, max = 200) => {
    const value = form[name];
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const name = text("name", 160);
  if (!name) return { problem: "Type the event or organiser's name." };
  const status = text("status") as Status;
  if (!STATUSES.includes(status)) return { problem: "Pick a status." };
  const dates: Record<string, string | null> = {};
  for (const [field, label] of [
    ["event_date", "event day"],
    ["sent_on", "day you sent it"],
    ["follow_up_on", "follow-up day"],
  ]) {
    const value = text(field!);
    if (value && !isDate(value)) return { problem: `Pick the ${label} from the calendar.` };
    dates[field!] = value || null;
  }
  const link = text("link", 500);
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { problem: "The link should start with https://" };
  let sentOn = dates.sent_on!;
  let followUpOn = dates.follow_up_on!;
  if (status === "Sent") {
    sentOn ??= today;
    followUpOn ??= addDays(sentOn, FOLLOW_UP_AFTER_DAYS);
  }
  return {
    name,
    kind: text("kind", 60) || null,
    eventDate: dates.event_date!,
    place: text("place", 160) || null,
    contact: text("contact", 300) || null,
    offer: text("offer", 300) || null,
    status,
    sentOn,
    followUpOn,
    link: link || null,
    notes: text("notes", 1000) || null,
  };
}

export interface PartnerSummary {
  counts: Record<Status, number>;
  /** Open leads with a follow-up day, soonest first. */
  followUps: Partner[];
  /** Everything, open leads first, then by event day. */
  all: Partner[];
}

export function summarisePartners(list: Partner[]): PartnerSummary {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const p of list) counts[p.status]++;
  const open = (p: Partner) => !CLOSED.includes(p.status);
  return {
    counts,
    followUps: list
      .filter((p) => p.followUpOn && open(p))
      .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!) || a.id - b.id),
    all: [...list].sort(
      (a, b) =>
        Number(!open(a)) - Number(!open(b)) ||
        (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999") ||
        a.id - b.id,
    ),
  };
}

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const options = (list: readonly string[], chosen?: string | null) =>
  list.map((o) => `<option value="${esc(o)}"${o === chosen ? " selected" : ""}>${esc(o)}</option>`).join("");

function partnerForm(p: Partner | undefined, today: string): string {
  const v = (s: string | null | undefined) => esc(s ?? "");
  const action = p ? `/dashboard/partners/${p.id}` : "/dashboard/partners";
  return `<form class="entry" id="${p ? "edit" : "add"}" method="post" action="${action}">
<h3>${p ? `Change ${esc(p.name)}` : "Add an event or organiser"}</h3>
<label class="wide">Event or organiser <input name="name" required maxlength="160" value="${v(p?.name)}" placeholder="e.g. Festival of African Cuisine" autocomplete="off"></label>
<label>Kind <input name="kind" list="kinds" maxlength="60" value="${v(p?.kind)}" placeholder="e.g. Festival"></label>
<datalist id="kinds">${KINDS.map((k) => `<option value="${esc(k)}">`).join("")}</datalist>
<label>Event day <input type="date" name="event_date" value="${v(p?.eventDate)}"></label>
<label>Where <input name="place" maxlength="160" value="${v(p?.place)}" placeholder="e.g. Muson Garden, Onikan"></label>
<label class="wide">Contact <input name="contact" maxlength="300" value="${v(p?.contact)}" placeholder="e.g. info@… · 0802 … · @handle"></label>
<label class="wide">What we offered <input name="offer" maxlength="300" value="${v(p?.offer)}" placeholder="e.g. vendor shops + code FOODFEST26"></label>
<label>Status <select name="status">${options(STATUSES, p?.status ?? "To contact")}</select></label>
<label>Sent on <input type="date" name="sent_on" value="${v(p?.sentOn)}" max="${today}"></label>
<label>Follow up on <input type="date" name="follow_up_on" value="${v(p?.followUpOn)}"></label>
<label class="wide">Link <input name="link" type="url" maxlength="500" value="${v(p?.link)}" placeholder="https://… event page or letter"></label>
<label class="wide">Notes <input name="notes" maxlength="1000" value="${v(p?.notes)}" placeholder="e.g. sent from useyarnoga@gmail.com, asked for a call"></label>
<div class="buttons"><button type="submit">${p ? "Save changes" : "Add"}</button>${p ? `<a href="/dashboard/partners">Cancel</a>` : ""}</div>
</form>`;
}

function row(p: Partner, today: string): string {
  const due = p.followUpOn && p.followUpOn <= today && !CLOSED.includes(p.status);
  const about = [p.kind, p.place].filter(Boolean).map((s) => esc(s!)).join(" · ");
  const link = p.link ? ` <a href="${esc(p.link)}" rel="noopener noreferrer" target="_blank">open</a>` : "";
  return `<tr class="st-${p.status.toLowerCase().replace(/ /g, "-")}"><td>${esc(p.name)}${link}${about ? `<span class="small">${about}</span>` : ""}${
    p.contact ? `<span class="small">${esc(p.contact)}</span>` : ""
  }${p.offer ? `<span class="small">Offered: ${esc(p.offer)}</span>` : ""}${p.notes ? `<span class="small">${esc(p.notes)}</span>` : ""}</td><td>${p.eventDate ? esc(shortDay(p.eventDate)) : "?"}</td><td><span class="status">${esc(p.status)}</span>${
    p.sentOn ? `<span class="small">sent ${esc(shortDay(p.sentOn))}</span>` : ""
  }</td><td>${p.followUpOn ? `${esc(shortDay(p.followUpOn))}${due ? ' <span class="flag">Due</span>' : ""}` : ""}</td><td class="acts"><a href="/dashboard/partners?edit=${p.id}#edit">Edit</a><form method="post" action="/dashboard/partners/${p.id}/delete" onsubmit="return confirm('Remove ${esc(
    p.name.replace(/['\\]/g, ""),
  )} from the list?')"><button class="link" type="submit">Remove</button></form></td></tr>`;
}

export function renderPartners(summary: PartnerSummary | "error", today: string, opts: { editId?: number; problem?: string } = {}): string {
  const notice = opts.problem ? `<p class="problem" role="alert">${esc(opts.problem)}</p>` : "";
  let body: string;
  if (summary === "error") {
    body = `<p class="problem">Couldn't read the partnerships list. If 0088_partner_leads.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`;
  } else {
    const c = summary.counts;
    const editing = opts.editId ? summary.all.find((p) => p.id === opts.editId) : undefined;
    const dueCount = summary.followUps.filter((p) => p.followUpOn! <= today && (p.status === "Sent" || p.status === "No reply")).length;
    const followRows = summary.followUps
      .map((p) => {
        const due = p.followUpOn! <= today;
        return `<tr${due ? ' class="losing"' : ""}><td>${esc(shortDay(p.followUpOn!))}${due ? ' <span class="flag">Due</span>' : ""}</td><td>${esc(p.name)}${
          p.contact ? `<span class="small">${esc(p.contact)}</span>` : ""
        }</td><td>${esc(p.status)}</td><td><a href="/dashboard/partners?edit=${p.id}#edit">Update</a></td></tr>`;
      })
      .join("");
    body = `${notice}
<section id="summary"><h2>Where things stand</h2>
<div class="tiles">
${tile("To contact", String(c["To contact"]))}
${tile("Sent, waiting", String(c.Sent + c["No reply"]), dueCount ? `${dueCount} to chase today` : "")}
${tile("Talking", String(c.Replied + c.Meeting), "replied or meeting")}
${tile("Agreed", String(c.Agreed), c.Declined ? `${c.Declined} declined` : "", c.Agreed ? "glow" : "")}
</div></section>
<section id="follow-ups"><h2>Follow-ups</h2>
<p class="intro">Open leads with a follow-up day, soonest first. Marking a lead Sent sets a follow-up ${FOLLOW_UP_AFTER_DAYS} days later unless you pick a day.</p>
<table class="plans wide"><thead><tr><th>Follow up on</th><th>Who</th><th>Status</th><th></th></tr></thead><tbody>${
      followRows || `<tr><td colspan="4">Nothing to follow up</td></tr>`
    }</tbody></table></section>
<section id="list"><h2>All leads</h2>
${editing ? partnerForm(editing, today) : partnerForm(undefined, today)}
<div class="scroll"><table class="plans wide leads"><thead><tr><th>Event or organiser</th><th>Event day</th><th>Status</th><th>Follow up</th><th></th></tr></thead><tbody>${
      summary.all.map((p) => row(p, today)).join("") || `<tr><td colspan="5">No leads yet. Add the first one above.</td></tr>`
    }</tbody></table></div></section>`;
  }
  return pageShell({
    title: "yarnOga partnerships",
    crumb: "Events and partners",
    heading: "yarn<b>Oga</b> partnerships",
    badge: "Saved as you go",
    nav: `<a href="/dashboard">Back to analytics</a><a href="#follow-ups">Follow-ups</a><a href="#list">All leads</a>`,
    body,
    css: `.leads { min-width:720px; }
.leads td { vertical-align:top; }
.leads td:first-child { min-width:240px; }
.leads td:nth-child(2), .leads td:nth-child(4) { white-space:nowrap; }
.leads .status { font-weight:600; }
.leads .acts { white-space:nowrap; }
.leads .acts form { display:inline; margin-left:10px; }
tr.st-agreed td:first-child { box-shadow:inset 3px 0 0 var(--lime); }
tr.st-declined td { opacity:.6; }
.entry select, .entry input[type=date] { color-scheme:dark; }
.entry + .scroll { margin-top:16px; }`,
  });
}

interface PartnerRow {
  id: number;
  name: string;
  kind: string | null;
  event_date: string | null;
  place: string | null;
  contact: string | null;
  offer: string | null;
  status: Status;
  sent_on: string | null;
  follow_up_on: string | null;
  link: string | null;
  notes: string | null;
}

const columns = (p: NewPartner) => ({
  name: p.name,
  kind: p.kind,
  event_date: p.eventDate,
  place: p.place,
  contact: p.contact,
  offer: p.offer,
  status: p.status,
  sent_on: p.sentOn,
  follow_up_on: p.followUpOn,
  link: p.link,
  notes: p.notes,
});

export function createSupabasePartnerStore(db: SupabaseClient): PartnerStore {
  return {
    async list() {
      const { data, error } = await db
        .from("partner_leads")
        .select("id, name, kind, event_date, place, contact, offer, status, sent_on, follow_up_on, link, notes");
      if (error) throw new Error(`Reading partner leads failed: ${error.message}`);
      return ((data ?? []) as PartnerRow[]).map((r) => ({
        id: Number(r.id),
        name: r.name,
        kind: r.kind,
        eventDate: r.event_date,
        place: r.place,
        contact: r.contact,
        offer: r.offer,
        status: r.status,
        sentOn: r.sent_on,
        followUpOn: r.follow_up_on,
        link: r.link,
        notes: r.notes,
      }));
    },
    async add(p) {
      const { error } = await db.from("partner_leads").insert(columns(p));
      if (error) throw new Error(`Saving a partner lead failed: ${error.message}`);
    },
    async update(id, p) {
      const { error } = await db.from("partner_leads").update({ ...columns(p), updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(`Updating a partner lead failed: ${error.message}`);
    },
    async remove(id) {
      const { error } = await db.from("partner_leads").delete().eq("id", id);
      if (error) throw new Error(`Removing a partner lead failed: ${error.message}`);
    },
  };
}
