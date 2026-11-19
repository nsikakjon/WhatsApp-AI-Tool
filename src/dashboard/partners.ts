import type { SupabaseClient } from "@supabase/supabase-js";
import { PACKAGE_CSS } from "./partner-package.js";
import { views } from "../core/admin-page.js";
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
  /** The partner's discount code (migration 0089). */
  promoCode?: string | null;
  /** The partner's own shop on yarnOga (migration 0089). */
  businessId?: string | null;
  /** When the event starts, "09:00" (migration 0089). */
  eventTime?: string | null;
  /** Ticket holders get a reminder the day before (partner-reminder.ts). */
  reminderOn?: boolean;
  reminderSentAt?: string | null;
  reminderSentCount?: number | null;
  /** Last day of the event (migration 0092); organisers get the report only for a month after it. */
  endsOn?: string | null;
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

/** The same lead after chasing it again: everything kept, next follow-up a few days from today. */
export function chasedAgain(p: Partner, today: string): NewPartner {
  const { name, kind, eventDate, place, contact, offer, status, sentOn, link, notes } = p;
  return { name, kind, eventDate, place, contact, offer, status, sentOn, followUpOn: addDays(today, FOLLOW_UP_AFTER_DAYS), link, notes };
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
<div class="buttons"><button type="submit">${p ? "Save changes" : "Add"}</button>${p ? `<a href="/dashboard/partners?view=leads">Cancel</a>` : ""}</div>
</form>`;
}

/** The three views of the page, picked from the top bar. */
export const PARTNER_VIEWS = ["today", "leads", "packages"] as const;
export type PartnerView = (typeof PARTNER_VIEWS)[number];

/** Ways to narrow the list of leads; the stat cards link to them too. */
export const LEAD_FILTERS: Array<[id: string, label: string, statuses: Status[] | null]> = [
  ["open", "Open", ["To contact", "Sent", "No reply", "Replied", "Meeting"]],
  ["to-contact", "To contact", ["To contact"]],
  ["waiting", "Sent, waiting", ["Sent", "No reply"]],
  ["talking", "Talking", ["Replied", "Meeting"]],
  ["agreed", "Agreed", ["Agreed"]],
  ["declined", "Declined", ["Declined"]],
  ["all", "All", null],
];

/** Leads shown before "Show all". */
export const LEADS_PER_PAGE = 15;

const isDue = (p: Partner, today: string) => Boolean(p.followUpOn && p.followUpOn <= today && !CLOSED.includes(p.status));
const statusClass = (s: Status) => `st-${s.toLowerCase().replace(/ /g, "-")}`;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function lateBy(p: Partner, today: string): string {
  const late = daysBetween(p.followUpOn!, today);
  return late <= 0 ? "Due today" : late === 1 ? "1 day late" : `${late} days late`;
}

/** A lead as one line: name, event day, status, follow-up and buttons, with the rest folded away. */
function leadItem(p: Partner, today: string): string {
  const about = [p.kind, p.place].filter(Boolean).map((s) => esc(s!)).join(" · ");
  const link = p.link ? `<a href="${esc(p.link)}" rel="noopener noreferrer" target="_blank">Open link</a>` : "";
  const more = [
    p.contact && `<span><b>Contact</b> ${esc(p.contact)}</span>`,
    p.offer && `<span><b>Offered</b> ${esc(p.offer)}</span>`,
    p.sentOn && `<span><b>Sent</b> ${esc(shortDay(p.sentOn))}</span>`,
    p.notes && `<span><b>Notes</b> ${esc(p.notes)}</span>`,
    link,
  ].filter(Boolean);
  return `<li class="lead ${statusClass(p.status)}">
<div class="who"><b>${esc(p.name)}</b>${about ? `<span class="small">${about}</span>` : ""}</div>
<div class="when"><span class="small">Event</span>${p.eventDate ? esc(shortDay(p.eventDate)) : "?"}</div>
<div class="st"><span class="badge">${esc(p.status)}</span></div>
<div class="when"><span class="small">Follow up</span>${p.followUpOn ? `${esc(shortDay(p.followUpOn))}${isDue(p, today) ? ' <span class="flag">Due</span>' : ""}` : "–"}</div>
<div class="acts"><a href="/dashboard/partners?view=leads&amp;edit=${p.id}#edit">Edit</a><form method="post" action="/dashboard/partners/${p.id}/delete" onsubmit="return confirm('Remove ${esc(
    p.name.replace(/['\\]/g, ""),
  )} from the list?')"><button class="link" type="submit">Remove</button></form></div>
${more.length ? `<details class="more"><summary>Details</summary><div>${more.join("")}</div></details>` : ""}
</li>`;
}

/** A follow-up to do: who, how to reach them, and buttons to update or mark it done. */
function chaseItem(p: Partner, today: string): string {
  const due = isDue(p, today);
  return `<li class="chase${due ? " due" : ""}">
<div class="who"><b>${esc(p.name)}</b>${p.contact ? `<span class="small">${esc(p.contact)}</span>` : ""}</div>
<div class="when">${due ? `<span class="flag">${esc(lateBy(p, today))}</span>` : esc(shortDay(p.followUpOn!))}<span class="small">${esc(p.status)}${p.eventDate ? ` · event ${esc(shortDay(p.eventDate))}` : ""}</span></div>
<div class="acts">${
    due
      ? `<form method="post" action="/dashboard/partners/${p.id}/chased"><button class="small-btn" type="submit" title="Sets the next follow-up ${FOLLOW_UP_AFTER_DAYS} days from today">Chased · again in ${FOLLOW_UP_AFTER_DAYS} days</button></form>`
      : ""
  }<a href="/dashboard/partners?view=leads&amp;edit=${p.id}#edit">Update</a></div>
</li>`;
}

export interface PackagePicker {
  /** Agreed partners, each with a package. */
  agreed: Partner[];
  /** The one shown. */
  current?: number;
  /** Its rendered package. */
  html: string;
}

export interface PartnersPageOptions {
  view?: PartnerView;
  /** One of LEAD_FILTERS, for the Leads view. */
  filter?: string;
  /** Show every lead, not just the first LEADS_PER_PAGE. */
  showAll?: boolean;
  editId?: number;
  problem?: string;
  saved?: string;
  packages?: PackagePicker;
}

/** Which agreed partner's package to show: the one asked for, else the next event to come. */
export function pickPackage(agreed: Partner[], asked: number | undefined, today: string): Partner | undefined {
  return (
    agreed.find((p) => p.id === asked) ??
    [...agreed].sort((a, b) => {
      const key = (p: Partner) => (p.eventDate && p.eventDate >= today ? `0${p.eventDate}` : `1${p.eventDate ?? ""}`);
      return key(a).localeCompare(key(b));
    })[0]
  );
}

export function renderPartners(summary: PartnerSummary | "error", today: string, opts: PartnersPageOptions = {}): string {
  const view: PartnerView = opts.editId ? "leads" : (opts.view ?? "today");
  const notice = opts.problem
    ? `<p class="problem" role="alert">${esc(opts.problem)}</p>`
    : opts.saved
      ? `<p class="saved" role="status">${esc(opts.saved)}</p>`
      : "";
  const due = summary === "error" ? [] : summary.followUps.filter((p) => isDue(p, today));
  let body: string;
  if (summary === "error") {
    body = `<p class="problem">Couldn't read the partnerships list. If 0088_partner_leads.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`;
  } else if (view === "today") {
    const c = summary.counts;
    const weekAhead = addDays(today, 7);
    const soon = summary.followUps.filter((p) => !isDue(p, today) && p.followUpOn! <= weekAhead);
    const events = summary.all.filter((p) => p.status === "Agreed" && p.eventDate && p.eventDate >= today).slice(0, 3);
    body = `${notice}
<div class="tiles glance">
${tile("To contact", String(c["To contact"]), "not pitched yet", "", "/partners?view=leads&filter=to-contact")}
${tile("Sent, waiting", String(c.Sent + c["No reply"]), "waiting for a reply", "", "/partners?view=leads&filter=waiting")}
${tile("Talking", String(c.Replied + c.Meeting), "replied or meeting", "", "/partners?view=leads&filter=talking")}
${tile("Agreed", String(c.Agreed), c.Declined ? `${c.Declined} declined` : "", c.Agreed ? "glow" : "", "/partners?view=leads&filter=agreed")}
</div>
<section id="due"><h2>Chase today${due.length ? ` <span class="count-pill">${due.length}</span>` : ""}</h2>
${
  due.length
    ? `<p class="intro">Follow-ups that are due or late. After you chase one, tap the button and it comes back in ${FOLLOW_UP_AFTER_DAYS} days.</p><ul class="chases">${due.map((p) => chaseItem(p, today)).join("")}</ul>`
    : `<p class="intro all-clear">Nothing to chase today.</p>`
}</section>
<section id="soon"><h2>Coming up this week</h2>
${soon.length ? `<ul class="chases">${soon.map((p) => chaseItem(p, today)).join("")}</ul>` : `<p class="intro">No follow-ups in the next 7 days.</p>`}
</section>
${
  events.length
    ? `<section id="events"><h2>Agreed events coming up</h2><ul class="chases">${events
        .map(
          (p) =>
            `<li class="chase"><div class="who"><b>${esc(p.name)}</b>${p.place ? `<span class="small">${esc(p.place)}</span>` : ""}</div><div class="when">${esc(shortDay(p.eventDate!))}<span class="small">in ${daysBetween(today, p.eventDate!)} days</span></div><div class="acts"><a href="/dashboard/partners?view=packages&amp;p=${p.id}">Package</a></div></li>`,
        )
        .join("")}</ul></section>`
    : ""
}`;
  } else if (view === "leads") {
    const editing = opts.editId ? summary.all.find((p) => p.id === opts.editId) : undefined;
    const [filterId, , statuses] = LEAD_FILTERS.find(([id]) => id === opts.filter) ?? LEAD_FILTERS[0]!;
    const matching = summary.all.filter((p) => !statuses || statuses.includes(p.status));
    const shown = opts.showAll ? matching : matching.slice(0, LEADS_PER_PAGE);
    const filters = views(
      LEAD_FILTERS.map(([id, label, st]) => [
        `/dashboard/partners?view=leads&filter=${id}`,
        label,
        st ? summary.all.filter((p) => st.includes(p.status)).length : summary.all.length,
      ]),
      `/dashboard/partners?view=leads&filter=${filterId}`,
      "Which leads",
    );
    body = `${notice}${filters}
${
  editing
    ? partnerForm(editing, today)
    : `<details class="add"${opts.problem || !summary.all.length ? " open" : ""}><summary>+ Add an event or organiser</summary>${partnerForm(undefined, today)}</details>`
}
<section id="list">${
      shown.length
        ? `<ul class="leads"><li class="head" aria-hidden="true"><span>Event or organiser</span><span>Event day</span><span>Status</span><span>Follow up</span><span></span></li>${shown.map((p) => leadItem(p, today)).join("")}</ul>${
            matching.length > shown.length
              ? `<p class="more-link"><a href="/dashboard/partners?view=leads&amp;filter=${filterId}&amp;all=1#list">Show all ${matching.length}</a></p>`
              : ""
          }`
        : `<p class="intro">${summary.all.length ? "No leads here." : "No leads yet. Add the first one above."}</p>`
    }</section>`;
  } else {
    const pk = opts.packages;
    const picker =
      pk && pk.agreed.length > 1
        ? views(
            pk.agreed.map((p) => [`/dashboard/partners?view=packages&p=${p.id}`, p.name]),
            `/dashboard/partners?view=packages&p=${pk.current}`,
            "Which partner",
          )
        : "";
    body = `${notice}${picker}
<section id="packages"><p class="intro">What we give each agreed partner: their discount code, and their shop once they've signed up on the bot. Mark a lead Agreed to set up its package here.</p>
${pk?.html || `<p class="intro">No agreed partnerships yet.</p>`}</section>`;
  }
  const tab = (id: PartnerView, label: string, extra = "") =>
    `<a href="/dashboard/partners${id === "today" ? "" : `?view=${id}`}"${id === view ? ' aria-current="page"' : ""}>${label}${extra}</a>`;
  return pageShell({
    title: "yarnOga partnerships",
    crumb: "Events and partners",
    heading: "yarn<b>Oga</b> partnerships",
    badge: "Saved as you go",
    nav: `<a class="back" href="/dashboard">‹ Analytics</a><span class="sep" aria-hidden="true"></span>${tab("today", "Today", due.length ? ` <span class="dot">${due.length}</span>` : "")}${tab("leads", "Leads")}${tab("packages", "Packages")}`,
    body,
    css: `.jump a[aria-current] { background:var(--lime); color:var(--limeink); border-color:transparent; }
.jump .sep { flex:none; width:1px; margin:4px 6px; background:var(--line2); }
.jump a.back { border-color:transparent; }
.jump .dot { display:inline-block; min-width:18px; margin-left:4px; padding:2px 6px; border-radius:99px; background:var(--red); color:#1a0703; font-size:11px; text-align:center; }
.glance { margin-top:24px; grid-template-columns:repeat(2,1fr); }
@media (min-width:760px) { .glance { grid-template-columns:repeat(4,1fr); } }
a.tile { display:block; color:inherit; text-decoration:none; transition:border-color .15s; }
a.tile:hover { border-color:rgba(198,255,31,.35); }
a.tile .label:after { content:" ›"; color:var(--dim); }
section { margin-top:32px; }
.count-pill { display:inline-block; margin-left:6px; padding:2px 10px; border-radius:99px; background:var(--redsoft); color:var(--red); font:600 14px/1.4 var(--body); vertical-align:middle; }
.chases, .leads { list-style:none; margin:12px 0 0; padding:0; border:1px solid var(--line); border-radius:14px; background:var(--glass),var(--surface); overflow:hidden; }
.chases > li, .leads > li { display:flex; flex-wrap:wrap; align-items:center; gap:6px 14px; padding:12px 16px; border-top:1px solid var(--line); }
.chases > li:first-child, .leads > li:first-child { border-top:0; }
.who, .acts, .more { flex-basis:100%; min-width:0; }
.chase.due { box-shadow:inset 3px 0 0 var(--red); }
.who b { font-weight:600; }
.who .small, .when .small { overflow-wrap:anywhere; }
.when { white-space:nowrap; font-variant-numeric:tabular-nums; font-size:14px; }
.when .small { display:inline; margin-left:8px; }
.when .flag { margin-left:0; }
.acts { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; font-size:14px; }
.acts form { display:inline; }
.small-btn { font:600 13px/1 var(--accent); padding:9px 12px; border-radius:9px; background:var(--limesoft); color:var(--lime); border:1px solid rgba(198,255,31,.25); cursor:pointer; }
.small-btn:hover { border-color:var(--lime); }
.leads .st { order:-1; }
.leads .head { display:none; }
.leads .acts, .leads .more { flex-basis:auto; }
.leads .more[open] { flex-basis:100%; }
.leads .who { order:-2; }
.leads .when .small { margin:0 6px 0 0; }
.badge { display:inline-block; padding:3px 10px; border-radius:99px; border:1px solid var(--line2); font-size:12.5px; font-weight:600; white-space:nowrap; }
.st-agreed .badge { background:var(--limesoft); color:var(--lime); border-color:transparent; }
.st-replied .badge, .st-meeting .badge { color:var(--mint); border-color:rgba(46,229,160,.3); }
.st-declined { opacity:.6; }
.lead.st-agreed { box-shadow:inset 3px 0 0 var(--lime); }
.more { margin-top:2px; }
.more > div { display:grid; gap:4px; margin-top:6px; color:var(--muted); overflow-wrap:anywhere; }
.more b { color:var(--dim); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.06em; margin-right:6px; }
@media (min-width:760px) {
  .chases > li, .leads > li { display:grid; gap:4px 16px; }
  .chases > li { grid-template-columns:minmax(0,1fr) 190px 300px; }
  .chases .when { text-align:right; }
  .chases .when .small { display:block; margin:0; }
  .chases .acts { justify-content:flex-end; }
  .leads > li { grid-template-columns:minmax(0,1fr) 120px 110px 160px 120px; }
  .leads .st, .leads .who { order:0; }
  .leads .head { display:grid; padding-block:10px; color:var(--dim); font:600 11px/1.4 var(--body); letter-spacing:.08em; text-transform:uppercase; }
  .leads .when .small { display:none; }
  .leads .acts { justify-content:flex-end; }
  .leads .more { grid-column:1 / -1; }
}
.more-link { margin:12px 0 0; }
details.add { margin-top:16px; }
details.add > summary { display:inline-block; padding:11px 18px; border-radius:10px; background:var(--limesoft); color:var(--lime); font:600 14px/1 var(--accent); border:1px solid rgba(198,255,31,.25); list-style:none; }
details.add > summary::-webkit-details-marker { display:none; }
.entry select, .entry input[type=date] { color-scheme:dark; }
.entry .buttons { grid-column:1 / -1; display:flex; align-items:center; gap:18px; }
.views + details.add, .views + .entry { margin-top:16px; }
#list { margin-top:16px; }
${PACKAGE_CSS}`,
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
  promo_code?: string | null;
  business_id?: string | null;
  event_time?: string | null;
  reminder_on?: boolean;
  reminder_sent_at?: string | null;
  reminder_sent_count?: number | null;
  ends_on?: string | null;
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
        // Every column, so the list still loads before migration 0089 adds the package columns.
        .select("*");
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
        promoCode: r.promo_code ?? null,
        businessId: r.business_id ?? null,
        eventTime: r.event_time ? r.event_time.slice(0, 5) : null,
        reminderOn: r.reminder_on === true,
        reminderSentAt: r.reminder_sent_at ?? null,
        reminderSentCount: r.reminder_sent_count ?? null,
        endsOn: r.ends_on ?? null,
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
