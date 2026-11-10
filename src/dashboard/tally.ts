import type { SupabaseClient } from "@supabase/supabase-js";
import { esc, pageShell, tile } from "./page.js";

// The door-to-door tally sheet at /dashboard/tally: one row per shop visited
// on a walk-in sales day, typed in on the phone between shops. A day only
// counts shops that went live before we left as live.

/** The goal for one day out, from the door-to-door plan. */
export const DAY_GOAL = { visited: 20, interested: 5, live: 2 };

export const SHOP_TYPES = [
  "Boutique",
  "Skincare and cosmetics",
  "Hair and wigs",
  "Phone accessories",
  "Cakes and food",
  "Pharmacy",
  "Parcel and delivery",
  "Salon",
  "Other",
];

export const PLACES = ["Admiralty Mall", "Vintage Mall", "Posh Plaza", "Delakes Mall", "Lekki Town Square Mall"];

export interface Progress {
  ownerIn: boolean;
  interested: boolean;
  signedUp: boolean;
  live: boolean;
  /** "2026-11-12", or null when there's nothing to go back for. */
  followUpOn: string | null;
}

export interface NewVisit extends Progress {
  /** "2026-11-11" */
  date: string;
  shop: string;
  type: string | null;
  place: string | null;
  notes: string | null;
}

export interface Visit extends NewVisit {
  id: number;
}

export interface TallyStore {
  list(): Promise<Visit[]>;
  add(visit: NewVisit): Promise<void>;
  update(id: number, progress: Progress): Promise<void>;
  remove(id: number): Promise<void>;
}

export interface DayTotals {
  date: string;
  visited: number;
  ownerIn: number;
  interested: number;
  signedUp: number;
  live: number;
}

export interface Tally {
  day: DayTotals;
  /** The chosen day's shops, in the order they were visited. */
  visits: Visit[];
  /** Every day with visits, newest first. */
  days: DayTotals[];
  /** Shops to go back to that aren't live yet, soonest first. */
  followUps: Visit[];
}

function totals(date: string, visits: Visit[]): DayTotals {
  const count = (k: "ownerIn" | "interested" | "signedUp" | "live") => visits.filter((v) => v[k]).length;
  return { date, visited: visits.length, ownerIn: count("ownerIn"), interested: count("interested"), signedUp: count("signedUp"), live: count("live") };
}

export function summariseTally(all: Visit[], date: string): Tally {
  const byDay = new Map<string, Visit[]>();
  for (const v of [...all].sort((a, b) => a.id - b.id)) {
    const list = byDay.get(v.date) ?? byDay.set(v.date, []).get(v.date)!;
    list.push(v);
  }
  const visits = byDay.get(date) ?? [];
  return {
    day: totals(date, visits),
    visits,
    days: [...byDay].map(([d, list]) => totals(d, list)).sort((a, b) => b.date.localeCompare(a.date)),
    followUps: all
      .filter((v) => v.followUpOn && !v.live)
      .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!) || a.id - b.id),
  };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** A day from the address bar, or `fallback` when it isn't a real date. */
export function pickDay(text: string | undefined, fallback: string): string {
  return text && isDate(text) ? text : fallback;
}

/**
 * The four ticks and the follow-up day. Each step implies the ones before it:
 * a shop that's live has signed up, and one that signed up was interested.
 */
export function parseProgress(form: Record<string, unknown>): Progress | { problem: string } {
  const on = (name: string) => form[name] === "on";
  const live = on("live");
  const signedUp = live || on("signed_up");
  const interested = signedUp || on("interested");
  const followUp = typeof form.follow_up_on === "string" ? form.follow_up_on.trim() : "";
  if (followUp && !isDate(followUp)) return { problem: "Pick the follow-up day from the calendar." };
  return { ownerIn: on("owner_in"), interested, signedUp, live, followUpOn: followUp || null };
}

/** Turns the "Add a shop" form into a visit, or explains what's wrong. */
export function parseVisitForm(form: Record<string, unknown>): NewVisit | { problem: string } {
  const text = (name: string, max = 120) => {
    const value = form[name];
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const date = text("date");
  if (!isDate(date)) return { problem: "Pick the day you visited the shop." };
  const shop = text("shop");
  if (!shop) return { problem: "Type the shop's name." };
  const progress = parseProgress(form);
  if ("problem" in progress) return progress;
  return { date, shop, type: text("type", 60) || null, place: text("place", 80) || null, notes: text("notes", 500) || null, ...progress };
}

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const options = (list: string[]) => list.map((o) => `<option value="${esc(o)}">`).join("");
const tick = (name: string, label: string, checked: boolean, form = "") =>
  `<label class="tick"><input type="checkbox" name="${name}"${checked ? " checked" : ""}${form ? ` form="${form}"` : ""}> ${esc(label)}</label>`;
const dayLink = (date: string) => `/dashboard/tally?day=${date}`;

function visitRow(v: Visit, n: number, day: string): string {
  const f = `visit-${v.id}`;
  const box = (name: string, checked: boolean, label: string) =>
    `<td class="box"><input type="checkbox" name="${name}" aria-label="${label}"${checked ? " checked" : ""} form="${f}"></td>`;
  const about = [v.type, v.place].filter(Boolean).map((s) => esc(s!)).join(" · ");
  return `<tr${v.live ? ' class="is-live"' : ""}><td>${n}</td><td>${esc(v.shop)}${about ? `<span class="small">${about}</span>` : ""}${
    v.notes ? `<span class="small">${esc(v.notes)}</span>` : ""
  }</td>${box("owner_in", v.ownerIn, "Owner in")}${box("interested", v.interested, "Interested")}${box("signed_up", v.signedUp, "Signed up")}${box("live", v.live, "Live today")}<td><input type="date" name="follow_up_on" value="${v.followUpOn ?? ""}" aria-label="Follow up on" form="${f}"></td><td class="acts"><form id="${f}" method="post" action="/dashboard/tally/${v.id}"><input type="hidden" name="day" value="${day}"><button type="submit">Save</button></form><form method="post" action="/dashboard/tally/${v.id}/delete" onsubmit="return confirm('Remove this shop from the sheet?')"><input type="hidden" name="day" value="${day}"><button class="link" type="submit">Remove</button></form></td></tr>`;
}

export function renderTally(tally: Tally | "error", today: string, day: string, problem?: string): string {
  const notice = problem ? `<p class="problem" role="alert">${esc(problem)}</p>` : "";
  let body: string;
  if (tally === "error") {
    body = `<p class="problem">Couldn't read the tally sheet. If 0079_door_visits.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`;
  } else {
    const d = tally.day;
    const isToday = day === today;
    const form = `<form class="entry" method="post" action="/dashboard/tally">
<h3>Add a shop</h3>
<input type="hidden" name="date" value="${day}">
<label class="wide">Shop <input name="shop" required maxlength="120" placeholder="e.g. Tolu's Closet" autocomplete="off"></label>
<label>Type <input name="type" list="shop-types" maxlength="60" placeholder="e.g. Boutique"></label>
<datalist id="shop-types">${options(SHOP_TYPES)}</datalist>
<label>Where <input name="place" list="places" maxlength="80" placeholder="e.g. Admiralty Mall"></label>
<datalist id="places">${options(PLACES)}</datalist>
<div class="ticks">${tick("owner_in", "Owner in", false)}${tick("interested", "Interested", false)}${tick("signed_up", "Signed up", false)}${tick("live", "Live today", false)}</div>
<label>Follow up on <input type="date" name="follow_up_on" min="${day}"></label>
<label class="wide">Notes <input name="notes" maxlength="500" placeholder="e.g. owner back at 2pm, uses a new SIM"></label>
<button type="submit">Add shop</button>
</form>`;
    const rows = tally.visits.map((v, i) => visitRow(v, i + 1, day)).join("");
    const sheet = `<div class="scroll"><table class="plans wide sheet"><thead><tr><th>#</th><th>Shop</th><th>Owner in?</th><th>Interested?</th><th>Signed up?</th><th>Live today?</th><th>Follow up on</th><th></th></tr></thead><tbody>${
      rows || `<tr><td colspan="8">No shops yet for ${esc(shortDay(day))}. Add the first one above.</td></tr>`
    }</tbody></table></div>`;
    const followRows = tally.followUps
      .map((v) => {
        const due = v.followUpOn! <= today;
        return `<tr${due ? ' class="losing"' : ""}><td>${esc(shortDay(v.followUpOn!))}${due ? ' <span class="flag">Due</span>' : ""}</td><td>${esc(v.shop)}${
          v.place ? `<span class="small">${esc(v.place)}</span>` : ""
        }</td><td>${v.signedUp ? "Signed up" : v.interested ? "Interested" : "Said not now"}</td><td><a href="${dayLink(v.date)}">${esc(shortDay(v.date))}</a></td></tr>`;
      })
      .join("");
    const dayRows = tally.days
      .map(
        (t) =>
          `<tr><td><a href="${dayLink(t.date)}">${esc(shortDay(t.date))}</a></td><td>${t.visited}</td><td>${t.ownerIn}</td><td>${t.interested}</td><td>${t.signedUp}</td><td>${t.live}</td></tr>`,
      )
      .join("");
    body = `${notice}
<section id="day"><h2>${isToday ? "Today" : esc(shortDay(day))}</h2>
<form class="pick" method="get" action="/dashboard/tally"><label>Day <input type="date" name="day" value="${day}"></label><button type="submit">Show</button>${
      isToday ? "" : ` <a href="/dashboard/tally">Back to today</a>`
    }</form>
<div class="tiles">
${tile("Shops visited", `${d.visited} / ${DAY_GOAL.visited}`, `owner in at ${d.ownerIn}`)}
${tile("Interested", `${d.interested} / ${DAY_GOAL.interested}`)}
${tile("Signed up", String(d.signedUp))}
${tile("Live", `${d.live} / ${DAY_GOAL.live}`, "only shops live before you left", d.live >= DAY_GOAL.live ? "glow" : "")}
</div>
${form}
${sheet}
<p class="intro">Change a tick or the follow-up day, then press Save on that row. Ticking Live also ticks Signed up and Interested.</p>
</section>
<section id="follow-ups"><h2>Follow-ups</h2>
<p class="intro">Shops to go back to that aren't live yet, from every day. Clear the date or tick Live once it's done.</p>
<table class="plans wide"><thead><tr><th>Go back on</th><th>Shop</th><th>Got to</th><th>Visited</th></tr></thead><tbody>${
      followRows || `<tr><td colspan="4">Nothing to follow up</td></tr>`
    }</tbody></table></section>
<section id="days"><h2>Every day out</h2>
<div class="scroll"><table class="plans wide days"><thead><tr><th>Day</th><th>Visited</th><th>Owner in</th><th>Interested</th><th>Signed up</th><th>Live</th></tr></thead><tbody>${
      dayRows || `<tr><td colspan="6">No days yet</td></tr>`
    }</tbody></table></div></section>
<footer>Goal for a day out: about ${DAY_GOAL.visited} shops visited, ${DAY_GOAL.interested} interested and ${DAY_GOAL.live} live.</footer>`;
  }
  return pageShell({
    title: "yarnOga tally sheet",
    crumb: "Door to door",
    heading: "yarn<b>Oga</b> tally sheet",
    badge: "Saved as you go",
    nav: `<a href="/dashboard">Back to analytics</a><a href="#day">Day</a><a href="#follow-ups">Follow-ups</a><a href="#days">Every day</a>`,
    body,
    css: `.sheet { min-width:760px; }
.sheet td { vertical-align:middle; }
.sheet td:nth-child(2) { min-width:170px; }
.days { min-width:520px; }
.days td a { white-space:nowrap; }
.sheet td.box { text-align:center; }
.sheet input[type=checkbox] { width:20px; height:20px; accent-color:var(--lime); }
.sheet input[type=date], .pick input { font:inherit; font-size:14px; color:var(--text); background:var(--bg); border:1px solid var(--line2); border-radius:8px; padding:6px 8px; color-scheme:dark; }
.sheet .acts { white-space:nowrap; }
.sheet .acts form { display:inline; }
.sheet .acts form + form { margin-left:10px; }
.sheet .acts button[type=submit]:not(.link), .pick button { font:600 13px/1 var(--accent); background:var(--limesoft); color:var(--lime); border:1px solid rgba(198,255,31,.25); border-radius:8px; padding:8px 12px; cursor:pointer; }
tr.is-live td:first-child { box-shadow:inset 3px 0 0 var(--lime); }
.pick { display:flex; flex-wrap:wrap; align-items:end; gap:10px; margin:12px 0 16px; font-size:13px; color:var(--muted); }
.pick label { display:flex; flex-direction:column; gap:6px; }
.entry input[type=date] { color-scheme:dark; }
.entry + .scroll { margin-top:16px; }`,
  });
}

interface VisitRow {
  id: number;
  visit_date: string;
  shop: string;
  shop_type: string | null;
  place: string | null;
  owner_in: boolean;
  interested: boolean;
  signed_up: boolean;
  live: boolean;
  follow_up_on: string | null;
  notes: string | null;
}

const progressColumns = (p: Progress) => ({
  owner_in: p.ownerIn,
  interested: p.interested,
  signed_up: p.signedUp,
  live: p.live,
  follow_up_on: p.followUpOn,
});

export function createSupabaseTallyStore(db: SupabaseClient): TallyStore {
  return {
    async list() {
      const { data, error } = await db
        .from("door_visits")
        .select("id, visit_date, shop, shop_type, place, owner_in, interested, signed_up, live, follow_up_on, notes");
      if (error) throw new Error(`Reading door visits failed: ${error.message}`);
      return ((data ?? []) as VisitRow[]).map((r) => ({
        id: Number(r.id),
        date: r.visit_date,
        shop: r.shop,
        type: r.shop_type,
        place: r.place,
        ownerIn: r.owner_in,
        interested: r.interested,
        signedUp: r.signed_up,
        live: r.live,
        followUpOn: r.follow_up_on,
        notes: r.notes,
      }));
    },
    async add(v) {
      const { error } = await db.from("door_visits").insert({
        visit_date: v.date,
        shop: v.shop,
        shop_type: v.type,
        place: v.place,
        notes: v.notes,
        ...progressColumns(v),
      });
      if (error) throw new Error(`Saving a door visit failed: ${error.message}`);
    },
    async update(id, p) {
      const { error } = await db.from("door_visits").update(progressColumns(p)).eq("id", id);
      if (error) throw new Error(`Updating a door visit failed: ${error.message}`);
    },
    async remove(id) {
      const { error } = await db.from("door_visits").delete().eq("id", id);
      if (error) throw new Error(`Removing a door visit failed: ${error.message}`);
    },
  };
}
