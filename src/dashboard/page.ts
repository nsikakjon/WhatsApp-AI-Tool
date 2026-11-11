import { pageShell } from "../core/admin-page.js";
import { formatNaira } from "../core/money.js";
import { AD_REPORT_DAYS } from "../core/ads.js";
import type { AdsReport } from "./ads.js";
import { META_FREE_MESSAGES, type ShopCost, type ShopCosts } from "./costs.js";
import type { MoneyLine, ProfitAndLoss } from "./profit.js";
import type { SocialAccount } from "./socials.js";
import { lagosDays, type DashboardStats, type NumberUse } from "./stats.js";
import type { WebsiteStats } from "./visits.js";

// The owner's dashboard as one HTML page in the yarnOga look. No scripts and no
// outside images; only the brand fonts come from Google Fonts.

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  standard: "Standard",
  premium: "Premium",
  deluxe: "Deluxe",
  organisation: "Organisation",
};

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function num(n: number): string {
  return n.toLocaleString("en-NG");
}

function lagosTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** look: "glow" for the headline number, "loss" for money going the wrong way. */
export function tile(label: string, value: string, note = "", look: "" | "glow" | "loss" = "", href = ""): string {
  const tag = href ? "a" : "div";
  return `<${tag}${href ? ` href="/dashboard${href}"` : ""} class="tile${look ? ` ${look}` : ""}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${
    note ? `<div class="note">${esc(note)}</div>` : ""
  }</${tag}>`;
}

function sentTable(rows: NumberUse[] | null): string {
  if (rows === null) return `<p class="problem">Messages sent per number will show here once migration 0043 is run in Supabase.</p>`;
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.label)}</td><td>${num(r.sent)}</td><td>${num(Math.max(0, r.sent - META_FREE_MESSAGES))}</td><td>${
          r.ownAccount ? "The business" : "yarnOga"
        }</td></tr>`,
    )
    .join("");
  return `<p class="intro">Messages each number sent this month. Meta charges for each one past the first ${num(META_FREE_MESSAGES)} on a number.</p><table class="plans wide"><thead><tr><th>Number</th><th>Sent</th><th>Past the free ${num(META_FREE_MESSAGES)}</th><th>Meta bills</th></tr></thead><tbody>${body}</tbody></table>`;
}

function costRow(s: ShopCost, withPlan = true): string {
  const c = s.cost;
  const breakdown = `AI ${formatNaira(c.aiKobo)} · voice ${formatNaira(c.voiceKobo)} · Meta ${formatNaira(c.metaKobo)}`;
  return `<tr${s.losing && withPlan ? ' class="losing"' : ""}><td>${esc(s.name)}${s.losing && withPlan ? ' <span class="flag">Loses money</span>' : ""}</td>${
    withPlan ? `<td>${esc(s.plan)}</td><td>${formatNaira(s.paysKobo)}</td>` : ""
  }<td>${num(s.aiReplies)}</td><td>${num(s.voiceNotes)}<span class="small">${num(s.voiceMinutes)} min</span></td><td>${num(s.sent)}</td><td>${formatNaira(c.totalKobo)}<span class="small">${esc(breakdown)}</span></td><td>${formatNaira(s.projectedKobo)}</td>${
    withPlan ? `<td class="${s.paysKobo - s.projectedKobo < 0 ? "expense" : "income"}">${signedNaira(s.paysKobo - s.projectedKobo)}</td>` : ""
  }</tr>`;
}

function costsSection(costs: ShopCosts | "error" | undefined): string {
  if (!costs) return "";
  const intro =
    "What each shop costs us this month in AI replies, voice notes and Meta message fees, against what its plan pays. Costs are worked out from each provider's list price; a shop is flagged when, at this month's pace, it will cost more than it pays.";
  if (costs === "error") {
    return section("costs", "Cost to serve each shop", intro, `<p class="problem">Shop costs couldn't load. Check that migration 0065 has been run in Supabase.</p>`);
  }
  const losingShops = costs.shops.filter((s) => s.losing);
  const losingPlans = costs.plans.filter((p) => p.losing && p.paysKobo > 0);
  const totalCost = [...costs.shops, ...costs.otherNumbers].reduce((sum, s) => sum + s.cost.totalKobo, 0);
  const head = (withPlan: boolean) =>
    `<thead><tr><th>${withPlan ? "Shop" : "Number"}</th>${withPlan ? "<th>Plan</th><th>Pays a month</th>" : ""}<th>AI replies</th><th>Voice notes</th><th>Messages sent</th><th>Cost so far</th><th>Cost by month end</th>${
      withPlan ? "<th>Left over</th>" : ""
    }</tr></thead>`;
  const planRows = costs.plans
    .map(
      (p) =>
        `<tr${p.losing ? ' class="losing"' : ""}><td>${esc(p.plan)}${p.losing && p.paysKobo > 0 ? ' <span class="flag">Loses money</span>' : ""}</td><td>${num(p.shops)}</td><td>${formatNaira(p.paysKobo)}</td><td>${formatNaira(p.projectedKobo)}</td><td class="${p.paysKobo - p.projectedKobo < 0 ? "expense" : "income"}">${signedNaira(p.paysKobo - p.projectedKobo)}</td></tr>`,
    )
    .join("");
  return section(
    "costs",
    "Cost to serve each shop",
    intro,
    `<div class="tiles">
${tile("Cost so far this month", formatNaira(totalCost), `all numbers, at ${formatNaira(costs.usdRateKobo)} to $1`)}
${tile("Shops costing more than they pay", num(losingShops.length), `of ${num(costs.shops.length)} shops, by month end at this pace`, losingShops.length ? "loss" : "")}
${tile("Paid plans losing money", num(losingPlans.length), losingPlans.length ? losingPlans.map((p) => p.plan).join(", ") : "every paid plan covers its shops' costs", losingPlans.length ? "loss" : "")}
</div>
<div class="scroll"><table class="plans wide costs-plans"><thead><tr><th>Plan</th><th>Shops</th><th>Pays a month</th><th>Cost by month end</th><th>Left over</th></tr></thead><tbody>${planRows}</tbody></table></div>
<div class="scroll"><table class="plans wide costs">${head(true)}<tbody>${costs.shops.map((s) => costRow(s)).join("")}</tbody></table></div>
${
  costs.otherNumbers.length
    ? `<p class="intro">Our own numbers that aren't a shop.</p><div class="scroll"><table class="plans wide costs">${head(false)}<tbody>${costs.otherNumbers.map((s) => costRow(s, false)).join("")}</tbody></table></div>`
    : ""
}
<p class="intro">"Pays a month" is the plan's monthly list price, not money received. Dollar costs use the latest dollar rate in Money. Meta's fee is $0.0067 a message past a number's free ${num(META_FREE_MESSAGES)}; numbers a business connected itself are billed to that business.</p>`,
  );
}

function adsSection(ads: AdsReport | "error" | undefined): string {
  if (!ads) return "";
  const intro = `People who messaged a number by tapping a Click-to-WhatsApp ad, per ad, over the last ${AD_REPORT_DAYS} days. Each chat is free for 72 hours after the first reply, templates included.`;
  if (ads === "error") {
    return section("ads", "Leads from ads", intro, `<p class="problem">Ad leads couldn't load. Check that migration 0072 has been run in Supabase.</p>`);
  }
  const total = (k: "leads" | "leads7" | "leads30" | "freeNow") => ads.ads.reduce((sum, a) => sum + a[k], 0);
  const rows = ads.ads
    .map((a) => {
      const name = a.headline ?? (a.sourceType === "post" ? "Facebook post" : "Ad with no headline");
      const link = a.sourceUrl && /^https:\/\//.test(a.sourceUrl) ? ` <a href="${esc(a.sourceUrl)}" rel="noopener noreferrer" target="_blank">open</a>` : "";
      return `<tr><td>${esc(name)}${link}<span class="small">ID ${esc(a.sourceId)}</span></td><td>${esc(a.label)}</td><td>${num(a.leads7)}</td><td>${num(a.leads30)}</td><td>${num(a.leads)}</td><td>${num(a.freeNow)}</td></tr>`;
    })
    .join("");
  return section(
    "ads",
    "Leads from ads",
    intro,
    `<div class="tiles">
${tile("Leads this week", num(total("leads7")), `${num(total("leads30"))} in the last 30 days`)}
${tile("In a free window now", num(total("freeNow")), "chats where every message is free")}
${tile("Sent free this month", num(ads.freeSentThisMonth), "messages not counted towards Meta's fees")}
</div>
${
  rows
    ? `<div class="scroll"><table class="plans wide"><thead><tr><th>Ad</th><th>Number</th><th>7 days</th><th>30 days</th><th>${AD_REPORT_DAYS} days</th><th>Free now</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="intro">No one has messaged from an ad yet. Leads show here from the first message after someone taps a Click-to-WhatsApp ad.</p>`
}`,
  );
}

function section(id: string, title: string, intro: string, body: string): string {
  return `<section id="${id}"><h2>${esc(title)}</h2><p class="intro">${esc(intro)}</p>${body}</section>`;
}

function dailyChart(
  days: { date: string; count: number }[],
  words = { caption: "Messages received per day", one: "message", many: "messages", column: "Messages" },
): string {
  const width = 900;
  const height = 170;
  const top = 12;
  const bottom = 22;
  const max = Math.max(1, ...days.map((d) => d.count));
  const slot = width / days.length;
  const barWidth = Math.max(2, slot - 4);
  const plot = height - top - bottom;
  const bars = days
    .map((d, i) => {
      const h = d.count === 0 ? 0 : Math.max(3, (d.count / max) * plot);
      const x = i * slot + (slot - barWidth) / 2;
      const y = top + plot - h;
      const label = `${shortDay(d.date)}: ${num(d.count)} ${d.count === 1 ? words.one : words.many}`;
      // A tall invisible strip behind each bar makes the hover/tap target easy to hit.
      return `<g class="day"><title>${esc(label)}</title><rect class="hit" x="${i * slot}" y="${top}" width="${slot}" height="${plot}"/>${
        h ? `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>` : ""
      }</g>`;
    })
    .join("");
  const first = days[0];
  const last = days[days.length - 1];
  const axis = first && last
    ? `<text x="0" y="${height - 4}" class="axis">${esc(shortDay(first.date))}</text><text x="${width}" y="${height - 4}" class="axis" text-anchor="end">${esc(shortDay(last.date))}</text>`
    : "";
  const rows = [...days]
    .reverse()
    .map((d) => `<tr><td>${esc(shortDay(d.date))}</td><td>${num(d.count)}</td></tr>`)
    .join("");
  return `<figure class="chart">
<figcaption>${esc(words.caption)}, last 30 days (busiest day: ${num(Math.max(0, ...days.map((d) => d.count)))})</figcaption>
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(words.caption)} over the last 30 days">
<line class="base" x1="0" x2="${width}" y1="${top + plot}" y2="${top + plot}"/>${bars}${axis}
</svg>
<details><summary>Show as a table</summary><table><thead><tr><th>Day</th><th>${esc(words.column)}</th></tr></thead><tbody>${rows}</tbody></table></details>
</figure>`;
}

function socialCard(a: SocialAccount): string {
  const badge = { live: "Live", not_connected: "Not connected", error: "Couldn't load" }[a.status];
  const stats = a.stats
    .map(
      (st) =>
        `<span class="stat"><b>${num(st.value)}</b> ${esc(st.label)}${st.note ? ` <i>(${esc(st.note)})</i>` : ""}</span>`,
    )
    .join("");
  const note = a.status === "not_connected" ? `Needs ${a.needs ?? "connecting"}.` : (a.problem ?? "");
  return `<div class="social ${a.status}"><a class="name" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a><span class="badge">${badge}</span>${stats}${
    note ? `<span class="note">${esc(note)}</span>` : ""
  }</div>`;
}

function rankTable(heading: string, rows: { label: string; views: number }[], empty: string): string {
  const body = rows.length
    ? rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${num(r.views)}</td></tr>`).join("")
    : `<tr><td colspan="2">${esc(empty)}</td></tr>`;
  return `<table class="plans"><thead><tr><th>${esc(heading)}</th><th>Views</th></tr></thead><tbody>${body}</tbody></table>`;
}

function websiteSection(w: WebsiteStats | "error" | undefined): string {
  if (!w) return "";
  const title = "Website (yarnoga.com)";
  const intro =
    "People opening yarnoga.com, counted by our own counter: no cookies, and search engines and link previews are left out. A visitor is one person on one day.";
  if (w === "error") {
    return section(
      "website",
      title,
      intro,
      `<p class="problem">Couldn't read the visitor numbers. If 0016_site_visits.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`,
    );
  }
  const busiest = Math.max(0, ...w.daily.map((d) => d.visitors));
  return section(
    "website",
    title,
    intro,
    `<div class="tiles">
${tile("Visitors today", num(w.visitorsToday), `${num(w.viewsToday)} page views`)}
${tile("Page views", num(w.views30), `last 30 days (${num(w.views7)} this week)`)}
${tile("Busiest day", num(busiest), "visitors, last 30 days")}
</div>${dailyChart(
      w.daily.map((d) => ({ date: d.date, count: d.visitors })),
      { caption: "Visitors per day", one: "visitor", many: "visitors", column: "Visitors" },
    )}
<div class="pair">${rankTable(
      "Top pages, last 30 days",
      w.topPages.map((p) => ({ label: p.path, views: p.views })),
      "No visits yet",
    )}${rankTable(
      "Came from, last 30 days",
      w.topSources.map((src) => ({ label: src.source || "Direct (typed, bookmark or an app)", views: src.views })),
      "No visits yet",
    )}</div>`,
  );
}

/** Like formatNaira, but a loss shows with a minus sign. */
function signedNaira(kobo: number): string {
  return kobo < 0 ? `−${formatNaira(-kobo)}` : formatNaira(kobo);
}

function monthName(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

function cents(minor: number): string {
  const whole = Math.floor(minor / 100).toLocaleString("en-US");
  return minor % 100 ? `$${whole}.${String(minor % 100).padStart(2, "0")}` : `$${whole}`;
}

function moneyLineRow(l: MoneyLine): string {
  const paid = l.currency === "USD" && l.usdRateKobo
    ? `<span class="small">${esc(cents(l.amountMinor))} at ${esc(formatNaira(l.usdRateKobo))}/$1</span>`
    : "";
  const sign = l.kind === "income" ? "+" : "−";
  const who = [l.supplier, l.category].filter(Boolean).join(" · ");
  return `<tr><td>${esc(shortDay(l.date))}</td><td>${esc(l.item)}${who ? `<span class="small">${esc(who)}</span>` : ""}${
    l.notes ? `<span class="small">${esc(l.notes)}</span>` : ""
  }</td><td class="${l.kind}">${sign}${esc(formatNaira(l.amountKobo))}${paid}</td><td class="actions"><a href="/dashboard?tab=money&amp;edit=${l.id}#edit">Edit</a><form method="post" action="/dashboard/money/${l.id}/delete" onsubmit="return confirm('Remove this entry?')"><button class="link" type="submit">Remove</button></form></td></tr>`;
}

/** Hundredths as typed in the form: 1200000 -> "12000", 2018 -> "20.18". */
function typedAmount(minor: number): string {
  return minor % 100 ? `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}` : String(minor / 100);
}

/** The fields shared by "Add an entry" and "Edit"; filled in from the entry when editing. */
function entryFields(today: string, usdRateKobo: number, line?: MoneyLine): string {
  const value = (text: string | null | undefined) => (text ? ` value="${esc(text)}"` : "");
  const chosen = (yes: boolean) => (yes ? " selected" : "");
  const rate = typedAmount(line?.usdRateKobo ?? usdRateKobo);
  return `<label>Date <input type="date" name="date" value="${line?.date ?? today}" required></label>
<label>Money <select name="kind"><option value="expense">Out (a cost)</option><option value="income"${chosen(line?.kind === "income")}>In (income)</option></select></label>
<label class="wide">What for <input name="item" required maxlength="200" placeholder="e.g. Railway, November"${value(line?.item)}></label>
<label>Paid to / from <input name="supplier" maxlength="200" placeholder="e.g. Railway"${value(line?.supplier)}></label>
<label>Category <input name="category" list="money-categories" maxlength="60" placeholder="e.g. Marketing"${value(line?.category)}></label>
<label>Amount <input name="amount" inputmode="decimal" required placeholder="e.g. 4500 or 20.18"${value(line && typedAmount(line.amountMinor))}></label>
<label>Currency <select name="currency"><option value="NGN">Naira (₦)</option><option value="USD"${chosen(line?.currency === "USD")}>Dollars ($)</option></select></label>
<label>Naira per $1 <input name="rate" inputmode="decimal" value="${esc(rate)}"><span class="small">only used for dollar amounts</span></label>
<label class="wide">Notes <input name="notes" maxlength="500"${value(line?.notes)}></label>`;
}

export interface ProfitView {
  pnl: ProfitAndLoss | "error";
  now: Date;
  /** Shown after a form that couldn't be saved. */
  problem?: string;
  /** The entry whose edit form is open. */
  editId?: number;
}

const EXPENSE_CATEGORIES = ["Setup", "Recurring", "One-off", "Marketing"];
const INCOME_CATEGORIES = ["Flyer plans", "Sales assistant", "Site reporter", "Lead qualifier", "Other"];

function profitSection(view: ProfitView | undefined): string {
  if (!view) return "";
  const title = "Profit and loss";
  const intro =
    "yarnOga's own money: costs and income you have entered. Flyer plan payments and setup fees aren't recorded automatically yet, so income here is only what you add below. KahnPrints sales are the shop's money and aren't counted.";
  const problem = view.problem ? `<p class="problem" role="alert">${esc(view.problem)}</p>` : "";
  if (view.pnl === "error") {
    return section(
      "money",
      title,
      intro,
      `<p class="problem">Couldn't read the profit and loss entries. If 0024_money_lines.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`,
    );
  }
  const p = view.pnl;
  const monthRows = p.months.length
    ? p.months
        .map(
          (m) =>
            `<tr><td>${esc(monthName(m.month))}</td><td>${esc(formatNaira(m.incomeKobo))}</td><td>${esc(formatNaira(m.expensesKobo))}</td><td class="${
              m.netKobo < 0 ? "expense" : "income"
            }">${esc(signedNaira(m.netKobo))}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No entries yet</td></tr>`;
  const categoryRows = (rows: { category: string; kobo: number }[], empty: string) =>
    rows.length
      ? rows.map((r) => `<tr><td>${esc(r.category)}</td><td>${esc(formatNaira(r.kobo))}</td></tr>`).join("")
      : `<tr><td colspan="2">${esc(empty)}</td></tr>`;
  const options = (list: string[]) => list.map((c) => `<option value="${esc(c)}">`).join("");
  const today = lagosDays(view.now, 1)[0].date;
  const categories = `<datalist id="money-categories">${options([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])}</datalist>`;
  const editing = p.lines.find((l) => l.id === view.editId);
  const edit = editing
    ? `<form id="edit" class="entry" method="post" action="/dashboard/money/${editing.id}"><h3>Edit: ${esc(editing.item)}</h3>
${entryFields(today, p.lastUsdRateKobo, editing)}
<div class="buttons"><button type="submit">Save changes</button><a href="/dashboard?tab=money#money">Cancel</a></div>
</form>`
    : "";
  const form = `<details class="add"${view.problem && !editing ? " open" : ""}><summary>+ Add an entry</summary><form class="entry" method="post" action="/dashboard/money">
${entryFields(today, p.lastUsdRateKobo)}
<button type="submit">Save entry</button>
</form></details>`;
  return section(
    "money",
    title,
    intro,
    `${problem}<div class="tiles">
${tile(p.netKobo < 0 ? "Loss so far" : "Profit so far", signedNaira(p.netKobo), "income minus costs, all time", p.netKobo < 0 ? "loss" : "glow")}
${tile("Income", formatNaira(p.incomeKobo), "all time, entered by you")}
${tile("Costs", formatNaira(p.expensesKobo), "all time")}
${p.months[0] ? tile(`${monthName(p.months[0].month)} result`, signedNaira(p.months[0].netKobo), "latest month with entries") : ""}
</div>
<table class="plans wide"><thead><tr><th>Month</th><th>Income</th><th>Costs</th><th>Profit / loss</th></tr></thead><tbody>${monthRows}</tbody></table>
<div class="pair">
<table class="plans"><thead><tr><th>Costs by category</th><th>Total</th></tr></thead><tbody>${categoryRows(p.expensesByCategory, "No costs yet")}</tbody></table>
<table class="plans"><thead><tr><th>Income by category</th><th>Total</th></tr></thead><tbody>${categoryRows(p.incomeByCategory, "No income entered yet")}</tbody></table>
</div>
${categories}${edit}
<details class="lines"${p.lines.length <= 10 || editing ? " open" : ""}><summary>All entries (${num(p.lines.length)})</summary>
<table class="plans wide"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th></th></tr></thead><tbody>${
      p.lines.map(moneyLineRow).join("") || `<tr><td colspan="4">No entries yet</td></tr>`
    }</tbody></table></details>
${form}`,
  );
}

export type DashboardTab = "overview" | "money" | "marketing" | "products";
export const DASHBOARD_TABS: DashboardTab[] = ["overview", "money", "marketing", "products"];

export interface DashboardView {
  tab?: DashboardTab;
  socials?: SocialAccount[];
  website?: WebsiteStats | "error";
  profit?: ProfitView;
  costs?: ShopCosts | "error";
  ads?: AdsReport | "error";
  planEditor?: boolean;
  numberQueue?: boolean;
  tallySheet?: boolean;
}

export function renderDashboard(s: DashboardStats, view: DashboardView = {}): string {
  const { tab = "overview", socials: socialAccounts = [], website, profit, costs, ads, planEditor, numberQueue, tallySheet } = view;
  const w = s.whatsapp;
  const f = s.flyers;
  const q = s.quotes;
  const site = s.site;
  const l = s.leads;

  const whatsapp = section(
    "whatsapp",
    "WhatsApp, all numbers",
    "Everyone who has messaged any yarnOga number: flyers, sales assistant, site reporter and lead qualifier together.",
    `<div class="tiles">
${tile("People who have messaged", num(w.contacts), `${num(w.newContacts7)} new this week, ${num(w.newContacts30)} in 30 days`)}
${tile("Messages received", num(w.inbound30), `last 30 days (${num(w.inbound7)} this week)`)}
${tile("Replies sent", num(w.outbound30), "last 30 days")}
${tile("Voice notes", num(w.voiceNotes30), "received in the last 30 days")}
</div>${dailyChart(w.dailyInbound)}${sentTable(w.sentThisMonth)}`,
  );

  const planRows = f.plans
    .map(
      (p) =>
        `<tr><td>${esc(PLAN_LABELS[p.id] ?? p.id)}</td><td>${num(p.groups)}</td><td>${
          p.monthlyPriceKobo === null ? "on request" : formatNaira(p.monthlyPriceKobo)
        }</td></tr>`,
    )
    .join("");
  const flyers = section(
    "flyers",
    "yarnOga Flyers",
    "Groups that use the birthday flyer bot, and the plans they are on.",
    `<div class="tiles">
${tile("Groups", num(f.groups), `${num(f.newGroups30)} signed up in the last 30 days`)}
${tile("Members", num(f.members), "birthdays the bot is tracking")}
${tile("Birthday flyers sent", num(f.birthdayFlyers30), `last 30 days (${num(f.birthdayFlyersAll)} all time)`)}
${tile("Groups on a paid plan", num(f.paidGroups), "plan that hasn't run out")}
${tile(
  "Paid plans are worth",
  `${formatNaira(f.planValueKobo)}/mo`,
  `at monthly list price, not money received${f.groupsOnRequestPrice ? `; plus ${num(f.groupsOnRequestPrice)} on a price-on-request plan` : ""}`,
)}
</div>
<table class="plans"><thead><tr><th>Plan</th><th>Groups</th><th>Monthly price</th></tr></thead><tbody>${planRows}</tbody></table>`,
  );

  const quotes = section(
    "quotes",
    "Sales assistant (KahnPrints)",
    "Quotes and orders from the print shop's WhatsApp. Sales here are KahnPrints' money, counted from orders marked paid.",
    `<div class="tiles">
${tile("Paid sales", formatNaira(q.paid30Kobo), `last 30 days (${formatNaira(q.paidKobo)} all time)`)}
${tile("Paid orders", num(q.paid), "all time")}
${tile("Confirmed, not yet paid", num(q.confirmed), `worth ${formatNaira(q.awaitingPaymentKobo)}`)}
${tile("Quotes not taken up", num(q.quoted), `${num(q.cancelled)} cancelled`)}
</div>`,
  );

  const reporter = section(
    "reporter",
    "yarnOga Site Reporter",
    "Updates site teams send in, and the daily reports the bot writes from them.",
    `<div class="tiles">
${tile("Active sites", num(site.sites), `${num(site.members)} team members`)}
${tile("Site updates", num(site.updates30), `last 30 days (${num(site.updates7)} this week)`)}
${tile("Photos and voice notes", `${num(site.photos30)} / ${num(site.voiceNotes30)}`, "last 30 days")}
${tile("Daily reports sent", num(site.reports30), "last 30 days")}
</div>`,
  );

  const leads = section(
    "leads",
    "Lead qualifier",
    "Enquiries the lead qualifier has chatted with, and how promising they look.",
    `<div class="tiles">
${tile("Enquiries", num(l.total), `${num(l.new30)} in the last 30 days`)}
${tile("Hot / warm / cold", `${num(l.hot)} / ${num(l.warm)} / ${num(l.cold)}`, "how ready to buy or rent")}
${tile("Handed to an agent", num(l.handedOff), "all time")}
</div>`,
  );

  const socials = section(
    "socials",
    "Socials",
    "Live numbers from each platform, refreshed every 10 minutes. An account that isn't connected shows no numbers: nothing here is guessed.",
    `<div class="socials">${socialAccounts.map(socialCard).join("")}</div>`,
  );

  const glanceTiles = [
    profit && profit.pnl !== "error"
      ? tile(profit.pnl.netKobo < 0 ? "Loss so far" : "Profit so far", signedNaira(profit.pnl.netKobo), "income minus costs, all time", profit.pnl.netKobo < 0 ? "loss" : "glow", "?tab=money")
      : "",
    tile("People on WhatsApp", num(w.contacts), `${num(w.newContacts7)} new this week`, profit ? "" : "glow", "?tab=products#whatsapp"),
    ads && ads !== "error"
      ? tile("Leads from ads", num(ads.ads.reduce((sum, a) => sum + a.leads7, 0)), "this week", "", "?tab=marketing#ads")
      : "",
    website && website !== "error"
      ? tile("Website visitors today", num(website.visitorsToday), `${num(website.views30)} page views in 30 days`, "", "?tab=marketing#website")
      : "",
    tile("Flyer groups", num(f.groups), `${num(f.paidGroups)} on a paid plan`, "", "?tab=products#flyers"),
    tile("Messages received", num(w.inbound30), "last 30 days", "", "?tab=products#whatsapp"),
  ].join("");

  const checks = [
    ...(costs && costs !== "error"
      ? costs.shops.filter((x) => x.losing).map((x) => [`${x.name} will cost more than it pays this month`, "?tab=money#costs"])
      : []),
    ...[
      [profit?.pnl === "error", "Profit and loss couldn't load", "?tab=money#money"],
      [costs === "error", "Shop costs couldn't load", "?tab=money#costs"],
      [ads === "error", "Leads from ads couldn't load", "?tab=marketing#ads"],
      [website === "error", "Website visits couldn't load", "?tab=marketing#website"],
    ]
      .filter(([bad]) => bad)
      .map(([, text, href]) => [text, href]),
    ...socialAccounts.filter((a) => a.status === "error").map((a) => [`${a.name} numbers couldn't load`, "?tab=marketing#socials"]),
  ] as [string, string][];
  const needsLook = `<section id="checks"><h2>Needs a look</h2>${
    checks.length
      ? `<ul class="checks">${checks.map(([text, href]) => `<li><a href="${href}">${esc(text)}</a></li>`).join("")}</ul>`
      : `<p class="intro all-clear">Nothing needs you right now: no shop is losing money and every section loaded.</p>`
  }</section>`;

  const tools: [string, string, string, boolean][] = [
    ["/dashboard/tally", "Tally sheet", "Shops visited on a door-to-door day, and who to go back to.", Boolean(tallySheet)],
    ["/dashboard/plans", "Edit plans", "Prices, limits and features of every plan.", Boolean(planEditor)],
    ["/quote-setup/numbers", "Numbers to connect", "Shops waiting for their WhatsApp number to be set up.", Boolean(numberQueue)],
  ];
  const shownTools = tools.filter(([, , , shown]) => shown);
  const toolCards = shownTools.length
    ? `<section id="tools"><h2>Tools</h2><div class="tools">${shownTools
        .map(([href, name, about]) => `<a class="tool" href="${href}"><b>${esc(name)}</b><span>${esc(about)}</span></a>`)
        .join("")}</div></section>`
    : "";

  const tabs: [DashboardTab, string, string][] = [
    ["overview", "Overview", `${needsLook}${toolCards}`],
    ["money", "Money", `${profitSection(profit)}${costsSection(costs)}`],
    ["marketing", "Marketing", `${adsSection(ads)}${websiteSection(website)}${socials}`],
    ["products", "Products", `${whatsapp}${flyers}${quotes}${reporter}${leads}`],
  ];
  const nav =
    tabs
      .map(([id, label]) => `<a href="/dashboard${id === "overview" ? "" : `?tab=${id}`}"${id === tab ? ' aria-current="page"' : ""}>${label}</a>`)
      .join("") +
    (shownTools.length ? `<span class="sep" aria-hidden="true"></span>` : "") +
    shownTools.map(([href, name]) => `<a class="tool-link" href="${href}">${esc(name)}</a>`).join("");

  return pageShell({
    title: "yarnOga analytics",
    crumb: `Updated ${lagosTime(s.generatedAt)}, Lagos time`,
    heading: "yarn<b>Oga</b> analytics",
    badge: "Live from the database",
    nav,
    body: `${tab === "overview" ? `<div class="tiles glance" aria-label="At a glance">${glanceTiles}</div>` : ""}
${tabs.find(([id]) => id === tab)![2]}
<footer>Refresh the page for the latest numbers. "Last 30 days" and "this week" count back from the moment the page loaded.</footer>`,
    css: DASHBOARD_CSS,
  });
}

const DASHBOARD_CSS = `@media (min-width:900px) { .glance { grid-template-columns:repeat(3,1fr); } }
.jump a[aria-current] { background:var(--lime); color:var(--limeink); border-color:transparent; }
.jump .sep { flex:none; width:1px; margin:4px 6px; background:var(--line2); }
.jump a.tool-link { border-style:dashed; }
a.tile { display:block; color:inherit; text-decoration:none; transition:border-color .15s, transform .15s; }
a.tile:hover { border-color:var(--line2); transform:translateY(-1px); }
a.tile .label:after { content:" ›"; color:var(--dim); }
.checks { list-style:none; margin:12px 0 0; padding:0; display:grid; gap:8px; }
.checks a { display:block; padding:14px 16px; border-radius:12px; background:var(--redsoft); border:1px solid rgba(255,138,122,.26); color:var(--text); text-decoration:none; }
.checks a:hover { border-color:var(--red); }
.all-clear { margin-top:8px; }
.tools { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-top:12px; }
.tool { display:flex; flex-direction:column; gap:6px; padding:18px; border-radius:14px; background:var(--glass),var(--surface); border:1px solid var(--line); color:var(--text); text-decoration:none; }
.tool b { font:600 15px/1.3 var(--accent); color:var(--lime); }
.tool span { color:var(--muted); font-size:13.5px; }
.tool:hover { border-color:rgba(198,255,31,.35); }
details.add { margin-top:16px; }
details.add > summary { display:inline-block; padding:11px 18px; border-radius:10px; background:var(--limesoft); color:var(--lime); font:600 14px/1 var(--accent); border:1px solid rgba(198,255,31,.25); list-style:none; }
details.add > summary::-webkit-details-marker { display:none; }
details.add[open] > summary { margin-bottom:0; }
td.actions { white-space:nowrap; }
td.actions a { margin-right:12px; font-size:13px; }
.entry .buttons { grid-column:1 / -1; display:flex; align-items:center; gap:18px; }`;

export { pageShell };
