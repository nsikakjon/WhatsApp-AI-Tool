import { mark } from "../core/brand.js";
import { formatNaira } from "../core/money.js";
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

function esc(text: string): string {
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
function tile(label: string, value: string, note = "", look: "" | "glow" | "loss" = ""): string {
  return `<div class="tile${look ? ` ${look}` : ""}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${
    note ? `<div class="note">${esc(note)}</div>` : ""
  }</div>`;
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
  }</td><td class="${l.kind}">${sign}${esc(formatNaira(l.amountKobo))}${paid}</td><td><form method="post" action="/dashboard/money/${l.id}/delete" onsubmit="return confirm('Remove this entry?')"><button class="link" type="submit">Remove</button></form></td></tr>`;
}

export interface ProfitView {
  pnl: ProfitAndLoss | "error";
  now: Date;
  /** Shown after a form that couldn't be saved. */
  problem?: string;
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
  const rate = (p.lastUsdRateKobo / 100).toString();
  const form = `<form class="entry" method="post" action="/dashboard/money">
<h3>Add an entry</h3>
<label>Date <input type="date" name="date" value="${today}" required></label>
<label>Money <select name="kind"><option value="expense">Out (a cost)</option><option value="income">In (income)</option></select></label>
<label class="wide">What for <input name="item" required maxlength="200" placeholder="e.g. Railway, November"></label>
<label>Paid to / from <input name="supplier" maxlength="200" placeholder="e.g. Railway"></label>
<label>Category <input name="category" list="money-categories" maxlength="60" placeholder="e.g. Recurring"></label>
<datalist id="money-categories">${options([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])}</datalist>
<label>Amount <input name="amount" inputmode="decimal" required placeholder="e.g. 4500 or 20.18"></label>
<label>Currency <select name="currency"><option value="NGN">Naira (₦)</option><option value="USD">Dollars ($)</option></select></label>
<label>Naira per $1 <input name="rate" inputmode="decimal" value="${esc(rate)}"><span class="small">only used for dollar amounts</span></label>
<label class="wide">Notes <input name="notes" maxlength="500"></label>
<button type="submit">Save entry</button>
</form>`;
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
<details class="lines"${p.lines.length <= 10 ? " open" : ""}><summary>All entries (${num(p.lines.length)})</summary>
<table class="plans wide"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th></th></tr></thead><tbody>${
      p.lines.map(moneyLineRow).join("") || `<tr><td colspan="4">No entries yet</td></tr>`
    }</tbody></table></details>
${form}`,
  );
}

export function renderDashboard(
  s: DashboardStats,
  socialAccounts: SocialAccount[] = [],
  website?: WebsiteStats | "error",
  profit?: ProfitView,
  costs?: ShopCosts | "error",
): string {
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

  const glance = `<div class="tiles glance" aria-label="At a glance">
${tile("People on WhatsApp", num(w.contacts), `${num(w.newContacts7)} new this week`, "glow")}
${tile("Messages received", num(w.inbound30), "last 30 days")}
${tile("Flyer groups", num(f.groups), `${num(f.paidGroups)} on a paid plan`)}
${website && website !== "error" ? tile("Website visitors today", num(website.visitorsToday), `${num(website.views30)} page views in 30 days`) : tile("Sales assistant orders", num(q.paid), "paid, all time")}
</div>`;

  const jumps: [string, string, boolean][] = [
    ["money", "Money", Boolean(profit)],
    ["costs", "Shop costs", Boolean(costs)],
    ["whatsapp", "WhatsApp", true],
    ["flyers", "Flyers", true],
    ["quotes", "Sales assistant", true],
    ["reporter", "Site reporter", true],
    ["leads", "Leads", true],
    ["website", "Website", Boolean(website)],
    ["socials", "Socials", true],
  ];
  const nav = jumps
    .filter(([, , shown]) => shown)
    .map(([id, label]) => `<a href="#${id}">${label}</a>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0a0d0b">
<title>yarnOga analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&family=Instrument+Sans:wght@400;500;600&family=Schibsted+Grotesk:wght@600&display=swap" rel="stylesheet">
<style>
:root {
  --bg:#0a0d0b; --surface:#0f1411; --surface2:#141b16; --surface3:#1c241f;
  --line:rgba(243,241,230,.1); --line2:rgba(243,241,230,.18);
  --text:#f3f1e6; --muted:rgba(243,241,230,.7); --dim:rgba(243,241,230,.54);
  --lime:#c6ff1f; --limeink:#121400; --limesoft:rgba(198,255,31,.1); --mint:#2ee5a0; --red:#ff8a7a; --redsoft:rgba(255,138,122,.12);
  --display:"Chakra Petch","Schibsted Grotesk",Arial,sans-serif;
  --accent:"Schibsted Grotesk","Helvetica Neue",Arial,sans-serif;
  --body:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --glass:linear-gradient(180deg,rgba(243,241,230,.035),rgba(243,241,230,.01));
}
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:72px; -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 var(--body); -webkit-font-smoothing:antialiased;
  background-image:radial-gradient(900px 500px at 85% -10%,rgba(198,255,31,.07),transparent 60%); background-attachment:fixed; }
a { color:var(--lime); text-underline-offset:3px; }
main, header { max-width:1120px; margin:0 auto; padding:0 16px; }
header { padding-top:28px; }
main { padding-bottom:56px; }
header { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.mark { display:block; overflow:visible; flex:none; filter:drop-shadow(0 0 14px rgba(198,255,31,.25)); }
header .titles { flex:1; min-width:220px; }
.crumb { margin:0 0 6px; color:var(--mint); font:600 11px/1.4 var(--body); letter-spacing:.12em; text-transform:uppercase; }
.crumb:before { content:"> "; }
h1 { margin:0; font:700 1.9rem/1.1 var(--display); letter-spacing:-.02em; }
h1 b { color:var(--lime); font-weight:inherit; }
.fresh { display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:99px; background:var(--limesoft); color:var(--lime); font-size:13px; font-weight:600; box-shadow:inset 0 0 0 1px rgba(198,255,31,.18); }
.fresh:before { content:""; width:7px; height:7px; border-radius:50%; background:var(--lime); box-shadow:0 0 8px var(--lime); }
.jump { position:sticky; top:0; z-index:10; margin-top:20px; background:rgba(10,13,11,.88); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); border-block:1px solid var(--line); }
.jump div { display:flex; gap:6px; overflow-x:auto; max-width:1120px; margin:0 auto; padding:10px 16px; scrollbar-width:none; }
.jump div::-webkit-scrollbar { display:none; }
.jump a { flex:none; padding:7px 13px; border-radius:99px; border:1px solid var(--line2); color:var(--muted); text-decoration:none; font:600 13px/1 var(--accent); }
.jump a:hover { color:var(--text); background:var(--surface2); }
.glance { margin-top:20px; }
section { margin-top:40px; }
h2 { margin:0 0 4px; font:700 1.3rem/1.2 var(--display); letter-spacing:-.01em; }
h3 { margin:0; font:600 15px/1.3 var(--accent); }
.intro { margin:0 0 16px; color:var(--muted); font-size:14px; max-width:72ch; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
@media (min-width:700px) { .tiles { grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); } }
.tile, .chart, .plans, .social, .problem, .entry { background:var(--glass),var(--surface); border:1px solid var(--line); border-radius:14px; }
.tile { padding:16px; min-width:0; }
.tile.glow { background:radial-gradient(120% 120% at 100% 0%,rgba(198,255,31,.16),transparent 55%),var(--glass),var(--surface); border-color:rgba(198,255,31,.22); }
.label { color:var(--muted); font-size:13px; font-weight:500; }
.value { margin:10px 0 6px; font:700 clamp(1.25rem,5.2vw,1.85rem)/1.1 var(--display); letter-spacing:-.01em; font-variant-numeric:tabular-nums; }
.glow .value { color:var(--lime); }
.tile.loss { background:radial-gradient(120% 120% at 100% 0%,rgba(255,138,122,.14),transparent 55%),var(--glass),var(--surface); border-color:rgba(255,138,122,.26); }
.loss .value { color:var(--red); }
.note { color:var(--dim); font-size:12.5px; }
.chart { margin:12px 0 0; padding:18px; }
.chart figcaption { font-size:13px; color:var(--muted); margin-bottom:10px; }
.chart svg { width:100%; height:auto; display:block; }
.chart .bar { fill:var(--lime); }
.chart .hit { fill:transparent; }
.chart .day:hover .hit { fill:var(--limesoft); }
.chart .day:hover .bar { fill:#e4ff8a; }
.chart .base { stroke:var(--line2); stroke-width:1; }
.chart .axis { fill:var(--dim); font:11px var(--body); }
details { margin-top:10px; font-size:13px; color:var(--muted); }
summary { cursor:pointer; }
summary:hover { color:var(--text); }
table { border-collapse:collapse; width:100%; max-width:520px; font-size:14px; }
th, td { text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
tr:last-child td { border-bottom:0; }
th { color:var(--dim); font:600 11px/1.4 var(--body); letter-spacing:.08em; text-transform:uppercase; }
.plans { margin-top:12px; overflow:hidden; border-collapse:separate; border-spacing:0; }
.chart table { margin-top:8px; }
.chart + .intro { margin-top:20px; }
.socials { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; }
.social { padding:18px; border-style:dashed; }
.social.live { border-style:solid; }
.social .name { font:600 15px/1.3 var(--accent); color:var(--text); text-decoration:none; }
.social .name:hover { color:var(--lime); }
.social .badge { display:inline-block; margin-left:8px; padding:2px 9px; border-radius:99px; border:1px solid var(--line2); color:var(--dim); font-size:11.5px; font-weight:600; }
.social.live .badge { background:var(--limesoft); color:var(--lime); border-color:transparent; }
.social.error .badge { background:var(--redsoft); color:var(--red); border-color:transparent; }
.social .stat { display:block; margin-top:8px; font-size:13.5px; color:var(--muted); }
.social .stat b { color:var(--text); font:700 1.3rem/1.2 var(--display); margin-right:3px; font-variant-numeric:tabular-nums; }
.social .stat i { font-style:normal; font-size:12px; color:var(--dim); }
.social .note { display:block; margin-top:8px; }
.pair { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
.pair table { max-width:none; }
.pair td:first-child { word-break:break-all; }
.wide { max-width:none; }
.scroll { overflow-x:auto; margin-top:12px; border-radius:14px; }
.costs { min-width:860px; }
.costs-plans { min-width:560px; }
.costs td.income, .costs td.expense, .costs-plans td { white-space:nowrap; }
.scroll + .intro { margin-top:20px; }
tr.losing td:first-child { box-shadow:inset 3px 0 0 var(--red); }
.flag { display:inline-block; margin-left:6px; padding:1px 8px; border-radius:99px; background:var(--redsoft); color:var(--red); font-size:11.5px; font-weight:600; white-space:nowrap; }
td.income { color:var(--lime); }
td.expense { color:var(--red); }
.small { display:block; color:var(--dim); font-size:12.5px; }
.lines { margin-top:12px; }
.problem + .tiles { margin-top:12px; }
.lines table { margin-top:8px; }
button.link { background:none; border:0; padding:0; color:var(--dim); text-decoration:underline; cursor:pointer; font:inherit; font-size:13px; }
button.link:hover { color:var(--red); }
.entry { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; padding:20px; margin-top:16px; }
.entry h3 { grid-column:1 / -1; }
.entry label { display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--muted); }
.entry .wide { grid-column:span 2; }
@media (max-width:480px) { .entry .wide { grid-column:auto; } }
.entry input, .entry select { font:inherit; font-size:15px; color:var(--text); background:var(--bg); border:1px solid var(--line2); border-radius:10px; padding:10px; min-width:0; }
.entry input:focus, .entry select:focus { outline:2px solid var(--lime); outline-offset:1px; border-color:transparent; }
.entry button[type=submit] { grid-column:1 / -1; justify-self:start; font:600 15px/1 var(--accent); background:var(--lime); color:var(--limeink); border:0; border-radius:10px; padding:13px 22px; cursor:pointer; }
.problem { padding:16px 18px; margin:0; border-color:rgba(255,138,122,.3); color:var(--text); }
footer { margin-top:48px; padding-top:20px; border-top:1px solid var(--line); color:var(--dim); font-size:12.5px; }
@media (min-width:960px) {
  main, header { padding-left:32px; padding-right:32px; }
  header { padding-top:40px; }
  main { padding-bottom:72px; }
  .jump div { padding:12px 32px; }
  h1 { font-size:2.2rem; }
  .tile { padding:22px; }
}
</style></head>
<body>
<header>
${mark("m", 48)}
<div class="titles">
<p class="crumb">Updated ${esc(lagosTime(s.generatedAt))}, Lagos time</p>
<h1>yarn<b>Oga</b> analytics</h1>
</div>
<span class="fresh">Live from the database</span>
</header>
<nav class="jump" aria-label="Sections"><div>${nav}</div></nav>
<main>
${glance}
${profitSection(profit)}
${costsSection(costs)}
${whatsapp}
${flyers}
${quotes}
${reporter}
${leads}
${websiteSection(website)}
${socials}
<footer>Refresh the page for the latest numbers. "Last 30 days" and "this week" count back from the moment the page loaded.</footer>
</main></body></html>`;
}
