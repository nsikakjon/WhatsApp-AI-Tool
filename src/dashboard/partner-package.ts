import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../core/money.js";
import { createSupabasePromoAdmin } from "../core/payments/promos.js";
import { normaliseWaId } from "../owner/auth.js";
import { cleanKeyword } from "../products/quote/shared-line.js";
import { esc } from "./page.js";
import { endForm } from "./partner-access.js";
import { orderPrefix } from "../products/quote/chat-signup.js";
import { renderOrganisers, type Organiser, type OrganiserInput, type OrganiserLogin } from "./partner-organisers.js";
import { createSupabaseTicketAdmin, renderTickets, TICKETS_CSS, type TicketAdmin, type TicketRow } from "./partner-tickets.js";
import { reminderText } from "./partner-reminder.js";
import type { Partner } from "./partners.js";

// The package for an agreed partnership, set up from /dashboard/partners by
// anyone on the yarnOga team: the partner's discount code (a promo_codes row),
// and the partner's own shop once they've signed up on the bot: what the bot
// tells their customers (About us), a plan given free until a date, and
// whether yarnOga takes its pay-link fee (migration 0089), the venue address
// for directions, and its tickets (partner-tickets.ts).

export const SHOP_ABOUT_MAX = 1500;
export const SHOP_ADDRESS_MAX = 200;

export interface CodeInput {
  code: string;
  percentOff: number;
  /** How many people can use it. Null = no limit. */
  maxUses: number | null;
  /** Last day it works, "2027-01-31". Null = no end. */
  endsOn: string | null;
  /** "quote", "flyer", or null for both. */
  product: "quote" | "flyer" | null;
  active: boolean;
}

export interface PartnerCode extends CodeInput {
  /** Different people who have paid with it. */
  used: number;
  /** Holding an unpaid discounted link (a day). */
  waiting: number;
  /** Shops that gave the code when signing up on the bot. */
  signups: number;
}

export interface ShopInput {
  about: string | null;
  /** A plan code from quote_plans. */
  planCode: string;
  /** Last day of the free plan time, "2026-12-31". Null = no end date. */
  planUntil: string | null;
  noFee: boolean;
  /** Where the event is, for the Directions button and the bot, e.g. "University of Uyo main auditorium, Uyo". */
  address: string | null;
  /**
   * Its keyword on the yarnOga quotes line (migration 0090), for a shop with no
   * number of its own. Undefined leaves it as it is (the field isn't shown
   * before that migration is run).
   */
  keyword?: string | null;
}

export interface PartnerShop extends ShopInput {
  id: string;
  name: string;
  ownerWaId: string | null;
  /** False until its own WhatsApp number is connected. */
  live: boolean;
  /** True when it has a number of its own, so a keyword on the yarnOga line isn't needed. */
  ownNumber?: boolean;
}

export interface PartnerLinks {
  /** Their customers' WhatsApp chat link (wa.me): their own number, or the yarnOga line with their keyword typed in. */
  chat?: string;
  /** Their shop page. */
  shop?: string;
  /** The door screen for checking tickets in. */
  door?: string;
}

export interface PartnerPackage {
  code: PartnerCode | null;
  shop: PartnerShop | null;
  /** Their price list, once a shop is linked. */
  tickets?: TicketRow[] | "error";
  links?: PartnerLinks;
  /** Their team's owner app logins; undefined when the owner app is off. */
  organisers?: Organiser[] | "error";
}

/** Links the app can make for a shop, when those features are switched on. */
export interface ShopLinkMaker {
  door?(businessId: string): string;
  /** Makes a one-time owner app login for someone on the shop's team (the owner app must be on). */
  login?(shop: { id: string; ownerWaId: string | null }, who: OrganiserInput): Promise<OrganiserLogin>;
  /** The yarnOga quotes line's number (digits), for keyword chat links. */
  lineNumber?(): Promise<string | null>;
  shop?(businessId: string, name: string): Promise<string>;
}

export interface PlanChoice {
  code: string;
  name: string;
  monthlyPriceKobo: number;
}

export interface PartnerPackageStore {
  load(partner: Partner): Promise<PartnerPackage>;
  plans(): Promise<PlanChoice[]>;
  /** Creates or changes the code and links it to the partner. Returns a problem to show, or null. */
  saveCode(partner: Partner, code: CodeInput): Promise<string | null>;
  /** Finds the shop that signed up from this owner number and links it. Returns a problem, or null. */
  linkShop(partner: Partner, ownerWaId: string): Promise<string | null>;
  unlinkShop(partner: Partner): Promise<void>;
  /** Returns a problem to show (e.g. the keyword is taken), or null. */
  saveShop(partner: Partner, shop: ShopInput): Promise<string | null>;
  /** Their tickets and price list, once a shop is linked. */
  tickets(partner: Partner): TicketAdmin | null;
  saveReminder(partner: Partner, reminder: ReminderInput): Promise<void>;
  /** The event's last day (migration 0092), or null for none. */
  saveEnd(partner: Partner, endsOn: string | null): Promise<void>;
  /** A login link for one of their organisers, or null when the owner app is off or no shop is linked. */
  organiserLogin(partner: Partner, who: OrganiserInput): Promise<OrganiserLogin | { problem: string } | null>;
  /** Makes a shop for the partner, named after it, with no owner yet, and links it. Returns a problem, or null. */
  createShop(partner: Partner): Promise<string | null>;
  /** The door screen link, to send organisers with their login. */
  doorLink(partner: Partner): string | undefined;
}

export interface ReminderInput {
  on: boolean;
  /** "09:00", or null when not set. */
  eventTime: string | null;
}

export function parseReminderForm(form: Record<string, unknown>): ReminderInput | { problem: string } {
  const time = field(form, "event_time", 8);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { problem: "Pick the start time from the clock." };
  return { on: field(form, "reminder_on") === "on", eventTime: time || null };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const field = (form: Record<string, unknown>, name: string, max = 200) => {
  const value = form[name];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};

export function parseCodeForm(form: Record<string, unknown>): CodeInput | { problem: string } {
  const code = field(form, "code", 40).toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{4,20}$/.test(code)) return { problem: "The code needs 4 to 20 letters or numbers, no spaces." };
  const percent = field(form, "percent_off");
  if (!/^\d{1,2}$/.test(percent) || Number(percent) < 1) return { problem: "Percent off should be a whole number from 1 to 99." };
  const max = field(form, "max_uses");
  if (max && (!/^\d{1,6}$/.test(max) || Number(max) < 1)) return { problem: "How many people should be a whole number, or empty for no limit." };
  const endsOn = field(form, "ends_on");
  if (endsOn && !isDate(endsOn)) return { problem: "Pick the last day from the calendar." };
  const product = field(form, "product");
  if (product && product !== "quote" && product !== "flyer") return { problem: "Pick which product the code works on." };
  return {
    code,
    percentOff: Number(percent),
    maxUses: max ? Number(max) : null,
    endsOn: endsOn || null,
    product: (product || null) as CodeInput["product"],
    active: field(form, "active") === "on",
  };
}

export function parseShopForm(form: Record<string, unknown>, plans: PlanChoice[]): ShopInput | { problem: string } {
  const planCode = field(form, "plan_code", 40);
  if (!plans.some((p) => p.code === planCode)) return { problem: "Pick a plan." };
  const planUntil = field(form, "plan_until");
  if (planUntil && !isDate(planUntil)) return { problem: "Pick the plan's last day from the calendar." };
  const raw = form.about;
  const about = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (about.length > SHOP_ABOUT_MAX) return { problem: `What the bot knows is ${about.length} characters; the most it takes is ${SHOP_ABOUT_MAX}.` };
  const address = field(form, "address", 400);
  if (address.length > SHOP_ADDRESS_MAX) return { problem: `The venue address is over ${SHOP_ADDRESS_MAX} characters. Keep it to the address; directions go in the FAQs.` };
  let keyword: string | null | undefined;
  if (typeof form.keyword === "string") {
    keyword = form.keyword.trim() ? cleanKeyword(form.keyword) : null;
    if (keyword === null && form.keyword.trim()) return { problem: "The keyword needs 3 to 30 letters or numbers, e.g. TEDXUNIUYO." };
  }
  return { about: about || null, address: address || null, planCode, planUntil: planCode === "free" ? null : planUntil || null, noFee: field(form, "no_fee") === "on", keyword };
}

/** "08012345678" -> "2348012345678", or null. */
export const ownerNumber = (form: Record<string, unknown>) => normaliseWaId(field(form, "owner_number", 40));

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function codeSummary(c: PartnerCode, today: string): string {
  const ended = c.endsOn && c.endsOn < today;
  const state = !c.active ? "Off" : ended ? "Ended" : "On";
  const where = c.product === "quote" ? "order bot plans" : c.product === "flyer" ? "flyer plans" : "any paid plan";
  const uses = c.maxUses == null ? `${c.used} paid, no limit` : `${c.used} of ${c.maxUses} paid, ${Math.max(c.maxUses - c.used - c.waiting, 0)} places left`;
  return `<p class="pk-line"><span class="code">${esc(c.code)}</span> <span class="state st-${state.toLowerCase()}">${state}</span> ${c.percentOff}% off the first month of ${where}${
    c.endsOn ? `, until ${esc(shortDay(c.endsOn))}` : ""
  }.</p><p class="small">${esc(uses)}${c.waiting ? ` (${c.waiting} holding an unpaid link)` : ""} · ${c.signups} signed up with it</p>`;
}

function codeForm(p: Partner, c: PartnerCode | null): string {
  const product = c?.product ?? "";
  const opt = (value: string, label: string) => `<option value="${value}"${value === product ? " selected" : ""}>${label}</option>`;
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/code">
<h3>Discount code</h3>
<p class="small wide-all">People type it when they sign up or upgrade and get the discount on their first month. ${c ? "Changing the code's name makes a new code; the old one stays as it is." : "Prices come from the plan, never from the bot."}</p>
<label>Code <input name="code" required maxlength="20" pattern="[A-Za-z0-9]{4,20}" value="${esc(c?.code ?? "")}" placeholder="e.g. TEDXUNIUYO" autocomplete="off"></label>
<label>Percent off <input name="percent_off" type="number" min="1" max="99" required value="${c?.percentOff ?? ""}" placeholder="e.g. 70"></label>
<label>How many people <input name="max_uses" type="number" min="1" value="${c?.maxUses ?? ""}" placeholder="Empty = no limit"></label>
<label>Last day <input type="date" name="ends_on" value="${esc(c?.endsOn ?? "")}"></label>
<label>Works on <select name="product">${opt("", "Any paid plan")}${opt("quote", "Order bot plans only")}${opt("flyer", "Flyer plans only")}</select></label>
<div class="ticks"><label class="tick"><input type="checkbox" name="active"${!c || c.active ? " checked" : ""}> Code is on</label></div>
<div class="buttons"><button type="submit">${c ? "Save code" : "Create code"}</button></div>
</form>`;
}

function reminderForm(p: Partner, s: PartnerShop): string {
  const status =
    p.reminderSentAt != null
      ? `Sent to ${p.reminderSentCount ?? 0} ticket holder${p.reminderSentCount === 1 ? "" : "s"}.`
      : !p.eventDate
        ? "Set the event day on the lead (Edit) first."
        : p.reminderOn
          ? "On: it goes out the day before, from 10am, to everyone holding a ticket that hasn't been used."
          : "Off.";
  const preview = p.eventDate ? reminderText({ event: p.name, eventDate: p.eventDate, eventTime: p.eventTime ?? null, address: s.address }) : "";
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/reminder">
<h3>Reminder the day before</h3>
<p class="small wide-all">${esc(status)}</p>
<label>Starts at <input type="time" name="event_time" value="${esc(p.eventTime ?? "")}"></label>
<div class="ticks"><label class="tick"><input type="checkbox" name="reminder_on"${p.reminderOn ? " checked" : ""}${p.reminderSentAt ? " disabled" : ""}> Send ticket holders a reminder</label></div>
${preview ? `<pre class="preview wide-all">${esc(preview)}</pre>` : ""}
<div class="buttons"><button type="submit"${p.reminderSentAt ? " disabled" : ""}>Save reminder</button><a href="/dashboard/partners/${p.id}/report">Event report</a></div>
</form>`;
}

function linkList(l: PartnerLinks | undefined): string {
  const rows = [
    l?.chat && ["Chat link (for flyers and QR codes)", l.chat],
    l?.shop && ["Shop page", l.shop],
    l?.door && ["Door screen (for their door team only)", l.door],
  ].filter(Boolean) as Array<[string, string]>;
  return rows.length
    ? `<ul class="links">${rows.map(([label, url]) => `<li><span class="small">${esc(label)}</span><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></li>`).join("")}</ul>`
    : "";
}

function shopForms(p: Partner, s: PartnerShop | null, plans: PlanChoice[]): string {
  if (!s) {
    return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/shop">
<h3>Their shop</h3>
<p class="small wide-all">Once they've signed up on the bot (send "sign up" to 0704 897 1600), type the WhatsApp number they signed up from to link their shop here.</p>
<label class="wide">Number they signed up from <input name="owner_number" required inputmode="tel" maxlength="40" placeholder="e.g. 0803 123 4567" autocomplete="off"></label>
<div class="buttons"><button type="submit">Link shop</button></div>
</form>
<form class="entry" method="post" action="/dashboard/partners/${p.id}/shop/create">
<h3>Or create their shop now</h3>
<p class="small wide-all">No sign-up needed: makes a shop called ${esc(p.name)} on the Free plan and links it. Then give it a keyword on the yarnOga quotes line, and make their logins below, ticking "account owner" for the person who adds the bank account.</p>
<div class="buttons"><button type="submit">Create their shop</button></div>
</form>`;
  }
  const choices = plans
    .map((pl) => `<option value="${esc(pl.code)}"${pl.code === s.planCode ? " selected" : ""}>${esc(pl.name)}${pl.monthlyPriceKobo ? ` (${esc(formatNaira(pl.monthlyPriceKobo))} a month)` : ""}</option>`)
    .join("");
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/shop/settings">
<h3>Their shop: ${esc(s.name)}</h3>
<p class="small wide-all">${
    s.ownNumber && s.live
      ? "Live on its own WhatsApp number."
      : s.keyword
        ? `Live on the yarnOga quotes line: visitors send ${esc(s.keyword.toUpperCase())} (or tap the chat link below).`
        : "Not live yet: connect its own WhatsApp number (Numbers to connect), or give it a keyword below to run on the yarnOga quotes line."
  }${s.ownerWaId ? ` Owner +${esc(s.ownerWaId)}.` : ""}</p>
${
  s.keyword !== undefined
    ? `<label class="wide-all">Keyword on the yarnOga quotes line (for a partner with no number of its own; empty = off) <input name="keyword" maxlength="30" value="${esc((s.keyword ?? "").toUpperCase())}" placeholder="e.g. TEDXUNIUYO" autocomplete="off"></label>
<p class="small wide-all">Visitors who send it chat with this shop's bot on our line until they send EXIT, another partner's keyword or "sign up", or go quiet for 14 days.</p>`
    : ""
}
<label class="wide-all">Venue address (for the Directions button and the bot) <input name="address" maxlength="${SHOP_ADDRESS_MAX}" value="${esc(s.address ?? "")}" placeholder="e.g. Main Auditorium, University of Uyo, Nwaniba Road, Uyo"></label>
<label>Plan <select name="plan_code">${choices}</select></label>
<label>Free until <input type="date" name="plan_until" value="${esc(s.planUntil ?? "")}"></label>
<p class="small wide-all">With a day picked, the plan goes back to Free after it and the owner gets the usual renewal reminders. Empty keeps the plan with no end.</p>
<label class="wide-all">What the bot knows (FAQs: programme, landmarks and how to get in, times, who to call). Also shown on their shop page. <textarea name="about" rows="9" maxlength="${SHOP_ABOUT_MAX}" placeholder="e.g. TEDxUNIUYO 2026 is on Saturday 28 November, 9am to 4pm, at the University of Uyo main auditorium...">${esc(s.about ?? "")}</textarea></label>
<div class="ticks"><label class="tick"><input type="checkbox" name="no_fee"${s.noFee ? " checked" : ""}> No yarnOga fee on their pay-link payments (tickets, invoices)</label></div>
<div class="buttons"><button type="submit">Save shop</button></div>
</form>
<form class="unlink" method="post" action="/dashboard/partners/${p.id}/shop/unlink" onsubmit="return confirm('Unlink this shop from the partnership? The shop itself stays as it is.')"><button class="link" type="submit">Unlink this shop</button></form>`;
}

/** The parts of a package, each folded away until opened. */
export const PACKAGE_PARTS = ["code", "shop", "organisers", "tickets", "reminder", "ends"] as const;
export type PackagePart = (typeof PACKAGE_PARTS)[number];

function part(id: PackagePart, title: string, state: string, body: string, open: boolean): string {
  return body
    ? `<details class="part" id="part-${id}"${open ? " open" : ""}><summary><b>${esc(title)}</b>${state ? `<span class="small">${esc(state)}</span>` : ""}</summary>${body}</details>`
    : "";
}

/**
 * One agreed partner's package: what's set up at a glance, then each part
 * (code, shop, logins, tickets, reminder, last day) folded away. `open` is the
 * part just saved, so it stays open; with no shop yet, the shop part opens.
 */
export function renderPackage(p: Partner, pkg: PartnerPackage | "error", plans: PlanChoice[], today: string, open?: PackagePart): string {
  let body: string;
  if (pkg === "error") {
    body = `<p class="problem">Couldn't load this package. If 0089_partner_packages.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`;
  } else {
    const { code, shop } = pkg;
    const tickets = pkg.tickets ?? [];
    const sold = tickets === "error" ? null : tickets.reduce((n, t) => n + (t.ticket ? t.sold : 0), 0);
    const plan = shop && plans.find((pl) => pl.code === shop.planCode)?.name;
    const reminder = p.reminderSentAt ? "Sent" : p.reminderOn ? "On" : "Off";
    const team = pkg.organisers;
    body = `<div class="pk-now">${code ? codeSummary(code, today) : `<p class="small">No discount code yet.</p>`}${shop ? linkList(pkg.links) : ""}</div>
${part("code", "Discount code", code ? code.code : "not set up", codeForm(p, code), open === "code")}
${part("shop", "Their shop", shop ? [shop.live || shop.keyword ? "Live" : "Not live yet", plan].filter(Boolean).join(" · ") : "not linked yet", shopForms(p, shop, plans), open === "shop" || !shop)}
${
  shop
    ? `${part("organisers", "Organiser logins", Array.isArray(team) ? `${team.length} made` : "", renderOrganisers(p, team, !shop.ownerWaId), open === "organisers")}
${part("tickets", "Tickets and price list", sold === null ? "" : `${sold} sold`, renderTickets(p.id, tickets), open === "tickets")}
${part("reminder", "Reminder the day before", reminder, reminderForm(p, shop), open === "reminder")}
${part("ends", "When the event ends", p.endsOn ? `last day ${shortDay(p.endsOn)}` : "no last day set", endForm(p, today), open === "ends")}`
    : ""
}`;
  }
  return `<article class="package" id="package-${p.id}"><h3>${esc(p.name)}${p.eventDate ? ` <span class="small inline">${esc(shortDay(p.eventDate))}</span>` : ""}</h3>${body}</article>`;
}

export const PACKAGE_CSS = `.package { margin-top:8px; }
.part { margin-top:10px; border:1px solid var(--line); border-radius:14px; background:var(--glass),var(--surface); color:var(--text); font-size:15px; }
.part > summary { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; padding:14px 16px; list-style:none; }
.part > summary::-webkit-details-marker { display:none; }
.part > summary:before { content:"+"; width:14px; color:var(--lime); font-weight:700; }
.part[open] > summary:before { content:"–"; }
.part > summary b { font:600 15px/1.3 var(--accent); }
.part > summary .small { display:inline; }
.part > .entry, .part > .scroll { margin:0 12px 12px; }
.part > .entry { background:var(--bg); }
.part > summary + .entry > h3:first-child { display:none; }
.part > .unlink { margin:0 16px 14px; }
.package > h3 { margin:16px 0 0; font:600 18px/1.3 var(--accent); }
.package .inline { display:inline; margin-left:8px; }
.package .entry h3 { margin:0; }
.package textarea { font:inherit; font-size:15px; color:var(--text); background:var(--bg); border:1px solid var(--line2); border-radius:10px; padding:10px; resize:vertical; }
.pk-now { margin-top:12px; }
.pk-line { margin:0; }
.code { font:600 14px/1 var(--accent); letter-spacing:.04em; background:var(--limesoft); color:var(--lime); padding:4px 8px; border-radius:6px; }
.state { font-size:12px; font-weight:600; padding:3px 8px; border-radius:20px; border:1px solid var(--line2); }
.st-on { color:var(--lime); }
.st-off, .st-ended { color:var(--red); }
.unlink { margin-top:8px; }
.package h4 { margin:22px 0 8px; font:600 15px/1.3 var(--accent); }
.links { list-style:none; margin:14px 0 0; padding:0; display:grid; gap:8px; }
.links a { word-break:break-all; }
.preview { white-space:pre-wrap; margin:0; padding:12px 14px; border-radius:10px; background:var(--bg); border:1px solid var(--line2); color:var(--muted); font-family:inherit; font-size:14px; line-height:1.5; overflow-wrap:anywhere; }
${TICKETS_CSS}`;

export function createSupabasePartnerPackageStore(db: SupabaseClient, makeLinks: ShopLinkMaker = {}): PartnerPackageStore {
  const promos = createSupabasePromoAdmin(db);

  async function readCode(code: string): Promise<PartnerCode | null> {
    const { data, error } = await db.from("promo_codes").select("*").eq("code", code).maybeSingle();
    if (error) throw new Error(`partner code failed: ${error.message}`);
    if (!data) return null;
    const usage = (await promos.codes()).find((u) => u.code === code);
    const { count, error: countError } = await db
      .from("quote_businesses")
      .select("id", { count: "exact", head: true })
      .eq("referral_code", code);
    if (countError) throw new Error(`partner code sign-ups failed: ${countError.message}`);
    return {
      code,
      percentOff: data.percent_off,
      maxUses: data.max_uses,
      endsOn: data.ends_on ?? null,
      product: data.product ?? null,
      active: data.active,
      used: usage?.used ?? 0,
      waiting: usage?.waiting ?? 0,
      signups: count ?? 0,
    };
  }

  async function readShop(id: string): Promise<(PartnerShop & { whatsappNumber: string | null }) | null> {
    const { data, error } = await db.from("quote_businesses").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`partner shop failed: ${error.message}`);
    if (!data) return null;
    return {
      id,
      name: data.name,
      ownerWaId: data.owner_wa_id ?? null,
      live: Boolean(data.active),
      planCode: data.plan_code ?? "free",
      planUntil: data.plan_paid_until ? new Date(new Date(data.plan_paid_until).getTime() + 3_600_000).toISOString().slice(0, 10) : null,
      noFee: data.no_fee === true,
      about: data.about ?? null,
      address: data.shop_address ?? null,
      // Undefined until migration 0090 is run, which hides the keyword field.
      keyword: "line_keyword" in data ? (data.line_keyword ?? null) : undefined,
      ownNumber: Boolean(data.phone_number_id),
      whatsappNumber: data.whatsapp_number ?? null,
    };
  }

  async function linksFor(shop: PartnerShop & { whatsappNumber?: string | null }): Promise<PartnerLinks> {
    const digits = shop.whatsappNumber?.replace(/\D/g, "");
    const line = !shop.ownNumber && shop.keyword && makeLinks.lineNumber ? await makeLinks.lineNumber().catch(() => null) : null;
    return {
      chat: line ? `https://wa.me/${line}?text=${encodeURIComponent(shop.keyword!.toUpperCase())}` : shop.live && digits ? `https://wa.me/${digits}` : undefined,
      shop: makeLinks.shop ? await makeLinks.shop(shop.id, shop.name).catch(() => undefined) : undefined,
      door: makeLinks.door?.(shop.id),
    };
  }

  async function readTeam(businessId: string): Promise<Organiser[]> {
    const { data, error } = await db
      .from("app_users")
      .select("name, wa_id, role, last_login_at")
      .eq("business_id", businessId)
      .eq("active", true)
      .in("role", ["owner", "organiser"])
      .order("created_at");
    if (error) throw new Error(`partner logins failed: ${error.message}`);
    return (data ?? []).map((r) => ({ name: r.name ?? null, waId: r.wa_id, role: r.role, lastLoginAt: r.last_login_at ?? null }));
  }

  async function setLead(id: number, change: Record<string, unknown>) {
    const { error } = await db.from("partner_leads").update({ ...change, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(`partner package link failed: ${error.message}`);
  }

  return {
    async load(p) {
      const shop = p.businessId ? await readShop(p.businessId) : null;
      if (!shop) return { code: p.promoCode ? await readCode(p.promoCode) : null, shop: null };
      const { whatsappNumber: _number, ...rest } = shop;
      const [code, tickets, links, organisers] = await Promise.all([
        p.promoCode ? readCode(p.promoCode) : null,
        createSupabaseTicketAdmin(db, shop.id)
          .rows()
          .catch((err) => {
            console.error("Partner's price list failed to load:", err);
            return "error" as const;
          }),
        linksFor(shop),
        makeLinks.login ? readTeam(shop.id).catch((err) => (console.error("Partner's logins failed to load:", err), "error" as const)) : undefined,
      ]);
      return { code, shop: rest, tickets, links, organisers };
    },
    async plans() {
      const { data, error } = await db.from("quote_plans").select("code, name, monthly_price_kobo, active, sort_order").order("sort_order");
      if (error) throw new Error(`plans failed: ${error.message}`);
      return (data ?? []).filter((r) => r.active).map((r) => ({ code: r.code, name: r.name, monthlyPriceKobo: Number(r.monthly_price_kobo) }));
    },
    async saveCode(p, c) {
      const { data: existing, error } = await db.from("promo_codes").select("referrer_business_id").eq("code", c.code).maybeSingle();
      if (error) throw new Error(`partner code check failed: ${error.message}`);
      if (existing?.referrer_business_id) return `${c.code} is a shop's referral code. Pick another code.`;
      const { data: taken, error: takenError } = await db.from("partner_leads").select("id, name").eq("promo_code", c.code).neq("id", p.id).limit(1);
      if (takenError) throw new Error(`partner code check failed: ${takenError.message}`);
      if (taken?.length) return `${c.code} is already ${taken[0]!.name}'s code. Pick another code.`;
      const { error: saveError } = await db.from("promo_codes").upsert(
        { code: c.code, percent_off: c.percentOff, max_uses: c.maxUses, ends_on: c.endsOn, product: c.product, active: c.active },
        { onConflict: "code" },
      );
      if (saveError) throw new Error(`partner code save failed: ${saveError.message}`);
      await setLead(p.id, { promo_code: c.code });
      return null;
    },
    async linkShop(p, waId) {
      const { data, error } = await db
        .from("quote_businesses")
        .select("id, name, created_at")
        .eq("owner_wa_id", waId)
        .is("branch_of", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(`partner shop lookup failed: ${error.message}`);
      if (!data?.length) return `No shop has signed up from +${waId} yet. They sign up by sending "sign up" to 0704 897 1600.`;
      await setLead(p.id, { business_id: data[0]!.id });
      return null;
    },
    tickets: (p) => (p.businessId ? createSupabaseTicketAdmin(db, p.businessId) : null),
    async organiserLogin(p, who) {
      if (!p.businessId || !makeLinks.login) return null;
      const shop = await readShop(p.businessId);
      if (!shop) return null;
      let ownerWaId = shop.ownerWaId;
      if (who.owner && ownerWaId !== who.waId) {
        if (ownerWaId) return { problem: `This shop's account owner is already +${ownerWaId}. Untick "account owner" to give ${who.name} an organiser login.` };
        // Order alerts go to the owner's number too.
        const { error } = await db.from("quote_businesses").update({ owner_wa_id: who.waId, updated_at: new Date().toISOString() }).eq("id", shop.id);
        if (error) throw new Error(`setting the shop owner failed: ${error.message}`);
        ownerWaId = who.waId;
      }
      return makeLinks.login({ id: shop.id, ownerWaId }, who);
    },
    async createShop(p) {
      if (p.businessId) return "This partner already has a shop linked.";
      const { data, error } = await db
        .from("quote_businesses")
        .insert({
          name: p.name,
          description: "an event",
          order_prefix: orderPrefix(p.name),
          plan_code: "free",
          // Switched off until it has a number of its own; a keyword on the quotes line works without.
          active: false,
          ...(p.promoCode ? { referral_code: p.promoCode } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(`creating the partner's shop failed: ${error.message}`);
      await setLead(p.id, { business_id: (data as { id: string }).id });
      return null;
    },
    doorLink: (p) => (p.businessId ? makeLinks.door?.(p.businessId) : undefined),
    async saveEnd(p, endsOn) {
      await setLead(p.id, { ends_on: endsOn });
    },
    async saveReminder(p, r) {
      await setLead(p.id, { reminder_on: r.on, event_time: r.eventTime });
    },
    async unlinkShop(p) {
      await setLead(p.id, { business_id: null });
    },
    async saveShop(p, s) {
      if (!p.businessId) throw new Error("No shop linked to this partner.");
      const { error } = await db
        .from("quote_businesses")
        .update({
          about: s.about,
          plan_code: s.planCode,
          // The end of that day in Lagos.
          plan_paid_until: s.planUntil ? new Date(`${s.planUntil}T23:59:59+01:00`).toISOString() : null,
          no_fee: s.noFee,
          shop_address: s.address,
          ...(s.keyword !== undefined ? { line_keyword: s.keyword } : {}),
        })
        .eq("id", p.businessId);
      if (error?.code === "23505") return `Another shop already uses the keyword ${s.keyword?.toUpperCase()}. Pick another.`;
      if (error) throw new Error(`partner shop save failed: ${error.message}`);
      return null;
    },
  };
}
