import { formatNaira } from "../core/money.js";
import type { SocialAccount } from "./socials.js";
import type { DashboardStats } from "./stats.js";

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

function section(title: string, intro: string, body: string): string {
  return `<section><h2>${esc(title)}</h2><p class="intro">${esc(intro)}</p>${body}</section>`;
}

function dailyChart(days: DashboardStats["whatsapp"]["dailyInbound"]): string {
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
      const label = `${shortDay(d.date)}: ${num(d.count)} message${d.count === 1 ? "" : "s"}`;
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
<figcaption>Messages received per day, last 30 days (busiest day: ${num(Math.max(0, ...days.map((d) => d.count)))})</figcaption>
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Messages received per day over the last 30 days">
<line class="base" x1="0" x2="${width}" y1="${top + plot}" y2="${top + plot}"/>${bars}${axis}
</svg>
<details><summary>Show as a table</summary><table><thead><tr><th>Day</th><th>Messages</th></tr></thead><tbody>${rows}</tbody></table></details>
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

export function renderDashboard(s: DashboardStats, socialAccounts: SocialAccount[] = []): string {
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
    "Socials and website",
    "Live numbers from each platform, refreshed every 10 minutes. An account that isn't connected shows no numbers: nothing here is guessed.",
    `<div class="socials">${socialAccounts.map(socialCard).join("")}</div>`,
  );

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>yarnOga Dashboard</title>
<style>
:root { --bg:#f6f7f3; --panel:#ffffff; --line:#e1e3dc; --text:#151614; --muted:#5d6159; --accent:#3d6b00; --accent-soft:#e6f5c9; --bar:#4f8a00; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0c0d0d; --panel:#191a1a; --line:#2e302f; --text:#f3f4ef; --muted:#a1a49d; --accent:#c6ff1f; --accent-soft:#2a3310; --bar:#b4ea1a; }
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
footer { margin-top:32px; color:var(--muted); font-size:12.5px; }
</style></head>
<body><main>
<header>
<h1>yarn<b>Oga</b> dashboard</h1>
<p>Updated ${esc(lagosTime(s.generatedAt))} (Lagos time). Refresh the page for the latest numbers.</p>
<span class="live">Product numbers are live from the database</span>
</header>
${whatsapp}
${flyers}
${quotes}
${reporter}
${leads}
${socials}
<footer>"Last 30 days" and "this week" count back from the moment the page loaded.</footer>
</main></body></html>`;
}
