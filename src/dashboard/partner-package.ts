import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../core/money.js";
import { createSupabasePromoAdmin } from "../core/payments/promos.js";
import { normaliseWaId } from "../owner/auth.js";
import { esc } from "./page.js";
import { createSupabaseTicketAdmin, renderTickets, TICKETS_CSS, type TicketAdmin, type TicketRow } from "./partner-tickets.js";
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
}

export interface PartnerShop extends ShopInput {
  id: string;
  name: string;
  ownerWaId: string | null;
  /** False until its own WhatsApp number is connected. */
  live: boolean;
}

export interface PartnerLinks {
  /** Their customers' WhatsApp chat link (wa.me), once their number is connected. */
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
}

/** Links the app can make for a shop, when those features are switched on. */
export interface ShopLinkMaker {
  door?(businessId: string): string;
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
  saveShop(partner: Partner, shop: ShopInput): Promise<void>;
  /** Their tickets and price list, once a shop is linked. */
  tickets(partner: Partner): TicketAdmin | null;
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
  return { about: about || null, address: address || null, planCode, planUntil: planCode === "free" ? null : planUntil || null, noFee: field(form, "no_fee") === "on" };
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
</form>`;
  }
  const choices = plans
    .map((pl) => `<option value="${esc(pl.code)}"${pl.code === s.planCode ? " selected" : ""}>${esc(pl.name)}${pl.monthlyPriceKobo ? ` (${esc(formatNaira(pl.monthlyPriceKobo))} a month)` : ""}</option>`)
    .join("");
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/shop/settings">
<h3>Their shop: ${esc(s.name)}</h3>
<p class="small wide-all">${s.live ? "Live on WhatsApp." : "Not live yet: waiting for its WhatsApp number to be connected (Numbers to connect)."}${s.ownerWaId ? ` Owner +${esc(s.ownerWaId)}.` : ""}</p>
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

export function renderPackage(p: Partner, pkg: PartnerPackage | "error", plans: PlanChoice[], today: string): string {
  const body =
    pkg === "error"
      ? `<p class="problem">Couldn't load this package. If 0089_partner_packages.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`
      : `${pkg.code ? `<div class="pk-now">${codeSummary(pkg.code, today)}</div>` : ""}${codeForm(p, pkg.code)}${shopForms(p, pkg.shop, plans)}${
          pkg.shop ? `${linkList(pkg.links)}<h4>Tickets and price list</h4>${renderTickets(p.id, pkg.tickets ?? [])}` : ""
        }`;
  return `<article class="package" id="package-${p.id}"><h3>${esc(p.name)}${p.eventDate ? ` <span class="small inline">${esc(shortDay(p.eventDate))}</span>` : ""}</h3>${body}</article>`;
}

export const PACKAGE_CSS = `.package { margin-top:18px; padding:4px 0 8px; border-top:1px solid var(--line); }
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
      whatsappNumber: data.whatsapp_number ?? null,
    };
  }

  async function linksFor(shop: PartnerShop & { whatsappNumber?: string | null }): Promise<PartnerLinks> {
    const digits = shop.whatsappNumber?.replace(/\D/g, "");
    return {
      chat: shop.live && digits ? `https://wa.me/${digits}` : undefined,
      shop: makeLinks.shop ? await makeLinks.shop(shop.id, shop.name).catch(() => undefined) : undefined,
      door: makeLinks.door?.(shop.id),
    };
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
      const [code, tickets, links] = await Promise.all([
        p.promoCode ? readCode(p.promoCode) : null,
        createSupabaseTicketAdmin(db, shop.id)
          .rows()
          .catch((err) => {
            console.error("Partner's price list failed to load:", err);
            return "error" as const;
          }),
        linksFor(shop),
      ]);
      return { code, shop: rest, tickets, links };
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
        })
        .eq("id", p.businessId);
      if (error) throw new Error(`partner shop save failed: ${error.message}`);
    },
  };
}
