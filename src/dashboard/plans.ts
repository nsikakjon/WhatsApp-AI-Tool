import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../core/money.js";
import { esc, pageShell } from "./page.js";
import { parseHundredths } from "./profit.js";

// jay's plan editor at /dashboard/plans: change the quote bot's plan prices,
// limits and features, and the flyer plan prices, without SQL. Prices are
// typed in naira and saved in kobo, in the same tables the bots read
// (quote_plans, quote_plan_features, flyer_plans), so a change applies to the
// next message. The website and the other-currency prices (plan_prices) are
// separate and don't change.

export interface QuotePlan {
  code: string;
  name: string;
  monthlyPriceKobo: number;
  /** Price per month when paid a year at a time; null = no yearly option. */
  yearlyPriceKobo: number | null;
  setupFeeKobo: number;
  /** Confirmed orders a month; null = no limit. */
  orderLimit: number | null;
  showCredit: boolean;
  active: boolean;
  description: string | null;
}

export interface PlanFeature {
  feature: string;
  included: boolean;
  /** null = no limit. */
  usageLimit: number | null;
}

export interface FlyerPlan {
  id: string;
  /** null = price on request. */
  monthlyPriceKobo: number | null;
  yearlyPriceKobo: number | null;
  /** "From ₦73,000" for a price-on-request plan. */
  startingPriceKobo: number | null;
}

export interface Plans {
  quote: (QuotePlan & { features: PlanFeature[] })[];
  flyer: FlyerPlan[];
}

export type QuotePlanEdit = Omit<QuotePlan, "code" | "name">;
export type FlyerPlanEdit = Omit<FlyerPlan, "id">;

export interface PlanEditorStore {
  load(): Promise<Plans>;
  saveQuotePlan(code: string, plan: QuotePlanEdit, features: PlanFeature[]): Promise<void>;
  saveFlyerPlan(id: string, plan: FlyerPlanEdit): Promise<void>;
}

/** What each feature row means, and what its limit counts. */
const FEATURES: Record<string, { label: string; limit?: string }> = {
  ai_credits: { label: "AI replies", limit: "replies a month" },
  bot_messages: { label: "Bot messages", limit: "messages a month" },
  products: { label: "Price list", limit: "rows" },
  broadcasts: { label: "Broadcasts", limit: "messages a month" },
  branches: { label: "Branches", limit: "numbers, main included" },
  stations: { label: "Kitchen and bar screens", limit: "screens" },
  transaction_fee: { label: "Pay link fee", limit: "hundredths of a percent (250 = 2.5%)" },
  voice_notes: { label: "Voice notes" },
  invoices: { label: "Invoices and receipts" },
  staff_inbox: { label: "Staff inbox" },
  follow_ups: { label: "Follow-ups" },
  test_screen: { label: "Test screen" },
  delivery: { label: "Delivery and riders" },
  order_board: { label: "Order board" },
  sales_dashboard: { label: "Sales dashboard" },
  catalogue: { label: "Catalogue photos and stock" },
  walk_in: { label: "Walk-in orders" },
  customers_page: { label: "Customers page" },
  daily_summary: { label: "Morning summary" },
  pay_reminders: { label: "Payment reminders" },
  ratings: { label: "Ratings" },
  order_again: { label: "Order again" },
};

type Form = Record<string, unknown>;

const text = (form: Form, name: string) => {
  const v = form[name];
  return typeof v === "string" ? v.trim() : "";
};

/** "7,000" -> 700000 kobo; blank -> null; anything else -> undefined. */
function naira(form: Form, name: string): number | null | undefined {
  const v = text(form, name);
  if (!v) return null;
  return parseHundredths(v) ?? undefined;
}

/** "500" -> 500; blank -> null (no limit); anything else -> undefined. */
function count(form: Form, name: string): number | null | undefined {
  const v = text(form, name).replace(/,/g, "");
  if (!v) return null;
  return /^\d{1,9}$/.test(v) ? Number(v) : undefined;
}

export function parseQuotePlanForm(
  form: Form,
  features: string[],
): { plan: QuotePlanEdit; features: PlanFeature[] } | { problem: string } {
  const monthly = naira(form, "monthly");
  if (monthly == null) return { problem: "Type the monthly price in naira, like 7000 (0 for free)." };
  const yearly = naira(form, "yearly");
  if (yearly === undefined) return { problem: "Type the yearly price per month in naira, or leave it blank for no yearly option." };
  const setup = naira(form, "setup");
  if (setup === undefined) return { problem: "Type the setup fee in naira, or leave it blank for none." };
  const orderLimit = count(form, "orders");
  if (orderLimit === undefined) return { problem: "Type the orders allowed a month as a whole number, or leave it blank for no limit." };
  const edited: PlanFeature[] = [];
  for (const feature of features) {
    const usageLimit = count(form, `limit_${feature}`);
    if (usageLimit === undefined) {
      return { problem: `Type the ${FEATURES[feature]?.label ?? feature} limit as a whole number, or leave it blank for no limit.` };
    }
    edited.push({ feature, included: form[`on_${feature}`] === "on", usageLimit });
  }
  return {
    plan: {
      monthlyPriceKobo: monthly,
      yearlyPriceKobo: yearly,
      setupFeeKobo: setup ?? 0,
      orderLimit,
      showCredit: form.credit === "on",
      active: form.active === "on",
      description: text(form, "description").slice(0, 200) || null,
    },
    features: edited,
  };
}

export function parseFlyerPlanForm(form: Form): FlyerPlanEdit | { problem: string } {
  const monthly = naira(form, "monthly");
  const yearly = naira(form, "yearly");
  const starting = naira(form, "starting");
  if (monthly === undefined || yearly === undefined || starting === undefined) {
    return { problem: "Type prices in naira, like 4500, or leave a box blank." };
  }
  return { monthlyPriceKobo: monthly, yearlyPriceKobo: yearly, startingPriceKobo: starting };
}

/** Kobo as a naira amount to type back in: 700000 -> "7000", 625050 -> "6250.50". */
function nairaInput(kobo: number | null): string {
  if (kobo === null) return "";
  return kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2);
}

const field = (label: string, name: string, value: string, hint = "") =>
  `<label>${esc(label)}<input name="${name}" value="${esc(value)}" inputmode="decimal" autocomplete="off">${hint ? `<span class="small">${esc(hint)}</span>` : ""}</label>`;

const tick = (label: string, name: string, on: boolean) =>
  `<label class="tick"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${esc(label)}</label>`;

function quotePlanForm(p: Plans["quote"][number]): string {
  const features = p.features
    .map((f) => {
      const about = FEATURES[f.feature];
      return `<tr><td>${esc(about?.label ?? f.feature)}</td><td><input type="checkbox" name="on_${f.feature}" aria-label="${esc(about?.label ?? f.feature)} included"${
        f.included ? " checked" : ""
      }></td><td><input name="limit_${f.feature}" value="${f.usageLimit ?? ""}" inputmode="numeric" placeholder="no limit" aria-label="${esc(about?.label ?? f.feature)} limit"></td><td><span class="small">${esc(about?.limit ?? "")}</span></td></tr>`;
    })
    .join("");
  return `<form class="entry plan" method="post" action="/dashboard/plans/quote/${encodeURIComponent(p.code)}" id="quote-${esc(p.code)}">
<h3>${esc(p.name)}${p.active ? "" : ' <span class="flag">Hidden from owners</span>'}</h3>
${field("Monthly price (₦)", "monthly", nairaInput(p.monthlyPriceKobo), `saved as ${p.monthlyPriceKobo.toLocaleString("en-NG")} kobo`)}
${field("Per month, paid yearly (₦)", "yearly", nairaInput(p.yearlyPriceKobo), "blank = no yearly option")}
${field("Setup fee (₦)", "setup", p.setupFeeKobo ? nairaInput(p.setupFeeKobo) : "", "blank = none")}
${field("Orders a month", "orders", p.orderLimit === null ? "" : String(p.orderLimit), "blank = no limit")}
<label class="wide">What it adds (shown when an owner sends "plan")<input name="description" value="${esc(p.description ?? "")}" maxlength="200"></label>
<div class="ticks">${tick('"Powered by yarnOga" line', "credit", p.showCredit)}${tick("Offered to owners", "active", p.active)}</div>
${
  features
    ? `<div class="wide-all scroll"><table class="features"><thead><tr><th>Feature</th><th>Included</th><th>Limit</th><th></th></tr></thead><tbody>${features}</tbody></table></div>`
    : ""
}
<button type="submit">Save ${esc(p.name)}</button>
</form>`;
}

function flyerPlanForm(p: FlyerPlan): string {
  const name = p.id[0]!.toUpperCase() + p.id.slice(1);
  return `<form class="entry plan" method="post" action="/dashboard/plans/flyer/${encodeURIComponent(p.id)}" id="flyer-${esc(p.id)}">
<h3>${esc(name)}</h3>
${field("Monthly price (₦)", "monthly", nairaInput(p.monthlyPriceKobo), "blank = price on request")}
${field("Per month, paid yearly (₦)", "yearly", nairaInput(p.yearlyPriceKobo), "blank = no yearly option")}
${field("“From” price (₦)", "starting", nairaInput(p.startingPriceKobo), "for a price-on-request plan")}
<button type="submit">Save ${esc(name)}</button>
</form>`;
}

export function renderPlanEditor(plans: Plans | "error", notice?: { saved?: string; problem?: string }): string {
  const message = notice?.problem
    ? `<p class="problem" role="alert">${esc(notice.problem)}</p>`
    : notice?.saved
      ? `<p class="saved" role="status">Saved ${esc(notice.saved)}. The bots use the new figures from the next message.</p>`
      : "";
  const body =
    plans === "error"
      ? `<p class="problem">Couldn't read the plans from the database just now. Please refresh in a minute.</p>`
      : `${message}
<section id="quote"><h2>Sales assistant plans</h2>
<p class="intro">Prices are typed in naira and saved in kobo. The website and the cedi, CFA, shilling and dollar prices don't change from here: update those too when you change a price. A blank limit means no limit; an unticked feature is off on that plan.</p>
${plans.quote.map(quotePlanForm).join("")}</section>
<section id="flyers"><h2>Flyer plans</h2>
<p class="intro">Member limits for flyer plans are set in the flyer bot itself; only prices change here.</p>
${plans.flyer.map(flyerPlanForm).join("")}</section>
<footer>Every save is applied straight away. Current list: ${
          plans.quote.filter((p) => p.active).map((p) => `${p.name} ${formatNaira(p.monthlyPriceKobo)}`).join(", ")
        }.</footer>`;
  return pageShell({
    title: "yarnOga plans",
    crumb: "Plan editor",
    heading: "yarn<b>Oga</b> plans",
    badge: "Changes apply straight away",
    nav: `<a href="/dashboard">Back to analytics</a><a href="#quote">Sales assistant</a><a href="#flyers">Flyers</a>`,
    body,
  });
}

interface QuotePlanRow {
  code: string;
  name: string;
  monthly_price_kobo: number;
  monthly_price_paid_yearly_kobo: number | null;
  setup_fee_kobo: number;
  monthly_order_limit: number | null;
  show_credit: boolean;
  active: boolean;
  description: string | null;
  sort_order: number;
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function createSupabasePlanEditor(db: SupabaseClient): PlanEditorStore {
  const check = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };
  return {
    async load() {
      const [plans, features, flyer] = await Promise.all([
        db.from("quote_plans").select("*").order("sort_order"),
        db.from("quote_plan_features").select("plan_code, feature, included, usage_limit"),
        db.from("flyer_plans").select("*").order("sort_order"),
      ]);
      check("Reading quote_plans", plans.error);
      check("Reading quote_plan_features", features.error);
      check("Reading flyer_plans", flyer.error);
      const byPlan = new Map<string, PlanFeature[]>();
      for (const f of (features.data ?? []) as { plan_code: string; feature: string; included: boolean; usage_limit: number | null }[]) {
        const list = byPlan.get(f.plan_code) ?? byPlan.set(f.plan_code, []).get(f.plan_code)!;
        list.push({ feature: f.feature, included: f.included, usageLimit: numOrNull(f.usage_limit) });
      }
      const order = Object.keys(FEATURES);
      const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : order.length);
      return {
        quote: ((plans.data ?? []) as QuotePlanRow[]).map((r) => ({
          code: r.code,
          name: r.name,
          monthlyPriceKobo: Number(r.monthly_price_kobo),
          yearlyPriceKobo: numOrNull(r.monthly_price_paid_yearly_kobo),
          setupFeeKobo: Number(r.setup_fee_kobo),
          orderLimit: numOrNull(r.monthly_order_limit),
          showCredit: r.show_credit,
          active: r.active,
          description: r.description ?? null,
          features: (byPlan.get(r.code) ?? []).sort((a, b) => rank(a.feature) - rank(b.feature) || a.feature.localeCompare(b.feature)),
        })),
        flyer: ((flyer.data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          monthlyPriceKobo: numOrNull(r.monthly_price_kobo),
          yearlyPriceKobo: numOrNull(r.monthly_price_paid_yearly_kobo),
          startingPriceKobo: numOrNull(r.starting_price_kobo),
        })),
      };
    },
    async saveQuotePlan(code, p, features) {
      const { error } = await db
        .from("quote_plans")
        .update({
          monthly_price_kobo: p.monthlyPriceKobo,
          monthly_price_paid_yearly_kobo: p.yearlyPriceKobo,
          setup_fee_kobo: p.setupFeeKobo,
          monthly_order_limit: p.orderLimit,
          show_credit: p.showCredit,
          active: p.active,
          description: p.description,
        })
        .eq("code", code);
      check(`Saving plan ${code}`, error);
      if (features.length === 0) return;
      const saved = await db.from("quote_plan_features").upsert(
        features.map((f) => ({ plan_code: code, feature: f.feature, included: f.included, usage_limit: f.usageLimit })),
        { onConflict: "plan_code,feature" },
      );
      check(`Saving plan ${code} features`, saved.error);
    },
    async saveFlyerPlan(id, p) {
      const { error } = await db
        .from("flyer_plans")
        .update({
          monthly_price_kobo: p.monthlyPriceKobo,
          monthly_price_paid_yearly_kobo: p.yearlyPriceKobo,
          starting_price_kobo: p.startingPriceKobo,
        })
        .eq("id", id);
      check(`Saving flyer plan ${id}`, error);
    },
  };
}
