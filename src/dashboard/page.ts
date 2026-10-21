import { formatNaira } from "../core/money.js";
import type { MoneyLine, ProfitAndLoss } from "./profit.js";
import type { SocialAccount } from "./socials.js";
import { lagosDays, type DashboardStats } from "./stats.js";
import type { WebsiteStats } from "./visits.js";

// The owner's dashboard as one self-contained HTML page (no outside scripts,
// fonts or images), so it loads fast on a phone and nothing leaks to other sites.

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

function tile(label: string, value: string, note = ""): string {
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${
    note ? `<div class="note">${esc(note)}</div>` : ""
  }</div>`;
}

function section(title: string, intro: string, body: string, id = ""): string {
  return `<section${id ? ` id="${id}"` : ""}><h2>${esc(title)}</h2><p class="intro">${esc(intro)}</p>${body}</section>`;
}

function dailyChart(
  days: { date: string; count: number }[],
  words = { caption: "Messages received per day", one: "message", many: "messages", column: "Messages" },
): string {
  const width = 600;
  const height = 160;
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
      title,
      intro,
      `<p class="problem">Couldn't read the visitor numbers. If 0016_site_visits.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`,
    );
  }
  const busiest = Math.max(0, ...w.daily.map((d) => d.visitors));
  return section(
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
      title,
      intro,
      `<p class="problem">Couldn't read the profit and loss entries. If 0024_money_lines.sql hasn't been run in Supabase yet, run it (see docs/DASHBOARD.md).</p>`,
      "money",
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
    title,
    intro,
    `${problem}<div class="tiles">
${tile(p.netKobo < 0 ? "Loss so far" : "Profit so far", signedNaira(p.netKobo), "income minus costs, all time")}
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
    "money",
  );
}

export function renderDashboard(
  s: DashboardStats,
  socialAccounts: SocialAccount[] = [],
  website?: WebsiteStats | "error",
  profit?: ProfitView,
): string {
  const w = s.whatsapp;
  const f = s.flyers;
  const q = s.quotes;
  const site = s.site;
  const l = s.leads;

  const whatsapp = section(
    "WhatsApp, all numbers",
    "Everyone who has messaged any yarnOga number: flyers, sales assistant, site reporter and lead qualifier together.",
    `<div class="tiles">
${tile("People who have messaged", num(w.contacts), `${num(w.newContacts7)} new this week, ${num(w.newContacts30)} in 30 days`)}
${tile("Messages received", num(w.inbound30), `last 30 days (${num(w.inbound7)} this week)`)}
${tile("Replies sent", num(w.outbound30), "last 30 days")}
${tile("Voice notes", num(w.voiceNotes30), "received in the last 30 days")}
</div>${dailyChart(w.dailyInbound)}`,
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
    "Lead qualifier",
    "Enquiries the lead qualifier has chatted with, and how promising they look.",
    `<div class="tiles">
${tile("Enquiries", num(l.total), `${num(l.new30)} in the last 30 days`)}
${tile("Hot / warm / cold", `${num(l.hot)} / ${num(l.warm)} / ${num(l.cold)}`, "how ready to buy or rent")}
${tile("Handed to an agent", num(l.handedOff), "all time")}
</div>`,
  );

  const socials = section(
    "Socials",
    "Live numbers from each platform, refreshed every 10 minutes. An account that isn't connected shows no numbers: nothing here is guessed.",
    `<div class="socials">${socialAccounts.map(socialCard).join("")}</div>`,
  );

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>yarnOga Dashboard</title>
<style>
:root { --bg:#f6f7f3; --panel:#ffffff; --line:#e1e3dc; --text:#151614; --muted:#5d6159; --accent:#3d6b00; --accent-soft:#e6f5c9; --bar:#4f8a00; --loss:#b3261e; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0c0d0d; --panel:#191a1a; --line:#2e302f; --text:#f3f4ef; --muted:#a1a49d; --accent:#c6ff1f; --accent-soft:#2a3310; --bar:#b4ea1a; --loss:#ff8a80; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
header h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
header h1 b { color: var(--accent); }
header p { margin: 4px 0 0; color: var(--muted); }
.live { display:inline-block; margin-top:10px; padding:3px 10px; border-radius:99px; background:var(--accent-soft); color:var(--text); font-size:13px; }
section { margin-top: 28px; }
h2 { font-size: 18px; margin: 0 0 2px; }
.intro { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
.tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.tile { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; }
.label { color:var(--muted); font-size:13px; }
.value { font-size:26px; font-weight:650; letter-spacing:-0.02em; margin-top:2px; font-variant-numeric: tabular-nums; }
.note { color:var(--muted); font-size:12.5px; margin-top:2px; }
.chart { margin:10px 0 0; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; }
.chart figcaption { font-size:13px; color:var(--muted); margin-bottom:6px; }
.chart svg { width:100%; height:auto; display:block; }
.chart .bar { fill:var(--bar); }
.chart .hit { fill:transparent; }
.chart .day:hover .hit { fill:var(--accent-soft); }
.chart .base { stroke:var(--line); stroke-width:1; }
.chart .axis { fill:var(--muted); font-size:11px; }
details { margin-top:8px; font-size:13px; color:var(--muted); }
table { border-collapse:collapse; width:100%; max-width:480px; margin-top:8px; font-size:14px; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); font-variant-numeric: tabular-nums; }
th { color:var(--muted); font-weight:500; }
.plans { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-top:10px; }
.socials { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:10px; }
.social { background:var(--panel); border:1px dashed var(--line); border-radius:12px; padding:14px; }
.social.live { border-style:solid; }
.social .name { font-weight:600; color:var(--text); }
.social.live .badge { background:var(--accent-soft); color:var(--text); border-color:transparent; }
.social .stat { display:block; margin-top:6px; font-size:14px; color:var(--muted); }
.social .stat b { color:var(--text); font-size:20px; font-weight:650; margin-right:2px; font-variant-numeric: tabular-nums; }
.social .stat i { font-style:normal; font-size:12px; }
.social .badge { display:inline-block; margin-left:8px; padding:1px 8px; border-radius:99px; border:1px solid var(--line); color:var(--muted); font-size:12px; }
.social .note { display:block; margin-top:6px; color:var(--muted); font-size:12.5px; }
.pair { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:10px; }
.pair table { max-width:none; }
.pair td:first-child { word-break: break-all; }
.wide { max-width:none; }
td.income { color:var(--accent); }
td.expense { color:var(--loss); }
.small { display:block; color:var(--muted); font-size:12.5px; }
.lines { margin-top:10px; }
.problem + .tiles { margin-top:10px; }
.lines table { margin-top:6px; }
button.link { background:none; border:0; padding:0; color:var(--muted); text-decoration:underline; cursor:pointer; font:inherit; font-size:13px; }
.entry { display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; margin-top:14px; }
.entry h3 { grid-column: 1 / -1; margin:0; font-size:15px; }
.entry label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--muted); }
.entry .wide { grid-column: span 2; }
@media (max-width: 480px) { .entry .wide { grid-column: auto; } }
.entry input, .entry select { font:inherit; font-size:15px; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px; min-width:0; }
.entry button[type=submit] { grid-column: 1 / -1; justify-self:start; font:inherit; font-weight:600; background:var(--accent); color:var(--bg); border:0; border-radius:8px; padding:10px 18px; cursor:pointer; }
.problem { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; margin:0; }
footer { margin-top:32px; color:var(--muted); font-size:12.5px; }
</style></head>
<body><main>
<header>
<h1>yarn<b>Oga</b> dashboard</h1>
<p>Updated ${esc(lagosTime(s.generatedAt))} (Lagos time). Refresh the page for the latest numbers.</p>
<span class="live">Product numbers are live from the database</span>
</header>
${profitSection(profit)}
${whatsapp}
${flyers}
${quotes}
${reporter}
${leads}
${websiteSection(website)}
${socials}
<footer>"Last 30 days" and "this week" count back from the moment the page loaded.</footer>
</main></body></html>`;
}
