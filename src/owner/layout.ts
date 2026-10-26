import type { Role } from "./store.js";

// The owner app's look: yarnOga black and lime, glassy cards with a soft lime
// glow, a menu down the side on a laptop and a tab bar at the bottom on a
// phone. Plain HTML forms, no JavaScript needed, so it works on any phone
// browser and slow connections.

export function esc(text: string | null | undefined): string {
  return (text ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Line icons (24x24, drawn with the text colour). */
const ICONS: Record<string, string> = {
  home: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  inbox: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/>',
  orders: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  prices: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  delivery: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  test: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  posters: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h1M20 14h1"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  status: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  logout: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  whatsapp: '<path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 8 19.6Z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1.3 2 .9c-.2 1.1-1.2 1.9-2.3 1.9-3.3 0-6.3-3-6.3-6.3 0-1.1.8-2.1 1.9-2.3l.9 2Z"/>',
};

export function icon(name: string, size = 20): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Only owners see it. */
  ownerOnly?: boolean;
  /** Shown in the phone's bottom tab bar (the rest go under "More"). */
  tab?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: "home", tab: true },
  { href: "/app/inbox", label: "Inbox", icon: "inbox", tab: true },
  { href: "/app/orders", label: "Orders", icon: "orders", tab: true },
  { href: "/app/prices", label: "Price list", icon: "prices", tab: true },
  { href: "/app/delivery", label: "Riders & delivery", icon: "delivery" },
  { href: "/app/test", label: "Test your bot", icon: "test" },
  { href: "/app/posters", label: "QR posters", icon: "posters" },
  { href: "/app/export", label: "Export", icon: "export", ownerOnly: true },
  { href: "/app/settings", label: "Settings", icon: "settings", ownerOnly: true },
  { href: "/app/help", label: "Help", icon: "help" },
  { href: "/app/status", label: "Status", icon: "status" },
];

export interface Shell {
  title: string;
  active: string;
  businessName: string;
  userName: string;
  role: Role;
  /** Other businesses this person can switch to. */
  others?: Array<{ userId: string; name: string }>;
  /** A green or red note at the top, e.g. "Saved." */
  flash?: { ok: boolean; text: string } | null;
}

/** "KahnPrints" -> "K", "Ada Okafor" -> "AO". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export function page(s: Shell, body: string): string {
  const items = NAV.filter((n) => !n.ownerOnly || s.role === "owner");
  const link = (n: NavItem) =>
    `<a href="${n.href}"${n.href === s.active ? ' class="on" aria-current="page"' : ""}>${icon(n.icon)}<span>${n.label}</span></a>`;
  const main = items.slice(0, 7).map(link).join("");
  const rest = items.slice(7).map(link).join("");
  const switcher = s.others?.length
    ? `<form method="post" action="/app/switch" class="switch"><select name="user" aria-label="Switch business">${[
        `<option value="">${esc(s.businessName)}</option>`,
        ...s.others.map((o) => `<option value="${o.userId}">${esc(o.name)}</option>`),
      ].join("")}</select><button class="ghost small">Switch</button></form>`
    : "";
  const flash = s.flash ? `<p class="flash ${s.flash.ok ? "good" : "bad"}" role="status">${esc(s.flash.text)}</p>` : "";
  const role = s.role === "owner" ? "Owner" : "Staff";
  const tabs = items.filter((n) => n.tab);
  const moreActive = !tabs.some((n) => n.href === s.active);
  const logout = `<form method="post" action="/app/logout"><button class="navbtn">${icon("logout")}<span>Log out</span></button></form>`;
  return doc(
    s.title,
    `<div class="shell">
<aside class="side" aria-label="Menu">
  <a class="brand" href="/app"><span class="mark" aria-hidden="true"></span><span>yarn<b>Oga</b></span></a>
  <nav class="nav">${main}<p class="navhead">More</p>${rest}</nav>
  <div class="me"><span class="avatar">${esc(initials(s.businessName))}</span><div><b>${esc(s.businessName)}</b><span>${esc(s.userName)} · ${role}</span></div></div>
  ${switcher}${logout}
</aside>
<div class="content">
  <header class="topbar"><div><p class="crumb">${esc(s.businessName)}</p><h1>${esc(s.title)}</h1></div>
    <div class="topactions"><a class="iconbtn" href="/app/help" aria-label="Help">${icon("help")}</a><span class="avatar" title="${esc(s.userName)} · ${role}">${esc(initials(s.userName))}</span></div></header>
  <main>${flash}${body}</main>
</div>
<nav class="tabs" aria-label="Main">${tabs.map(link).join("")}
  <details class="moretab${moreActive ? " on" : ""}"><summary>${icon("more")}<span>More</span></summary>
  <div class="sheet"><p class="sheethead">${esc(s.businessName)} · ${esc(s.userName)}</p>${items.filter((n) => !n.tab).map(link).join("")}${switcher}${logout}</div></details>
</nav>
</div>`,
  );
}

/** A page with no menu: login and link pages. */
export function bare(title: string, body: string): string {
  return doc(
    title,
    `<div class="auth"><div class="authcard"><a class="brand big" href="/app"><span class="mark" aria-hidden="true"></span><span>yarn<b>Oga</b></span></a>${body}</div>
<p class="authfoot">Your WhatsApp sales assistant · <a href="https://yarnoga.com">yarnoga.com</a></p></div>`,
  );
}

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#0a0b0b"><title>${esc(title)} · yarnOga</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23c6ff1f'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`;
}

/** A number card: label, value, and an optional line (or change pill) under it. */
export function stat(label: string, value: string, note = "", opts: { change?: number | null; glow?: boolean; icon?: string } = {}): string {
  const change =
    opts.change == null || !Number.isFinite(opts.change)
      ? ""
      : `<span class="pill ${opts.change >= 0 ? "up" : "down"}">${opts.change >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(opts.change))}%</span>`;
  return `<div class="stat${opts.glow ? " glow" : ""}"><div class="stathead"><p class="label">${esc(label)}</p>${opts.icon ? `<span class="staticon">${icon(opts.icon, 18)}</span>` : ""}</div>
<p class="value">${esc(value)}</p><p class="note">${change}${note ? `<span>${esc(note)}</span>` : ""}</p></div>`;
}

/** A bar for "used x of y". */
export function meter(used: number, limit: number | null): string {
  if (limit == null || limit <= 0) return "";
  const pct = Math.min(100, Math.round((used * 100) / limit));
  return `<div class="meter${pct >= 90 ? " hot" : ""}" role="img" aria-label="${pct}% used"><span style="width:${pct}%"></span></div>`;
}

/** A ring showing a percentage, with a big number in the middle. */
export function ring(pct: number, centre: string, caption: string): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="ring${p >= 90 ? " hot" : ""}" style="--p:${p}" role="img" aria-label="${esc(caption)}: ${p}%"><div><b>${esc(centre)}</b><span>${esc(caption)}</span></div></div>`;
}

const CSS = `
:root{
  --bg:#0a0b0b;--bg2:#0f1010;--surface:#131414;--surface2:#1a1b1b;--surface3:#222323;
  --line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.12);
  --text:#f4f5f0;--muted:#94978f;--dim:#6b6e68;
  --lime:#c6ff1f;--lime2:#a8e000;--limeink:#0a0b0b;--limesoft:rgba(198,255,31,.12);--limeglow:rgba(198,255,31,.18);
  --red:#ff7a6b;--redsoft:rgba(255,122,107,.12);--amber:#ffc24b;--ambersoft:rgba(255,194,75,.12);--blue:#7cb6ff;--bluesoft:rgba(124,182,255,.12);
  --r:20px;--r2:14px;--r3:10px;
  --glass:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));
}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(900px 500px at 85% -10%,rgba(198,255,31,.07),transparent 60%),radial-gradient(700px 400px at -10% 110%,rgba(198,255,31,.04),transparent 60%);background-attachment:fixed}
a{color:var(--lime);text-underline-offset:3px}
h1{font-size:1.65rem;line-height:1.15;letter-spacing:-.02em;margin:0;font-weight:700}
h2{font-size:1.05rem;letter-spacing:-.01em;margin:28px 0 12px;font-weight:600}
h3{font-size:.98rem;margin:0 0 6px;font-weight:600}
p{margin:0 0 .6em}.muted{color:var(--muted)}.small{font-size:.84rem}
.ico{flex:none;display:block}
code{background:var(--surface3);padding:1px 7px;border-radius:6px;font-size:.88em}

/* Shell */
.shell{min-height:100vh}
.side{display:none}
.content{min-width:0}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:rgba(10,11,11,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.crumb{margin:0 0 2px;color:var(--muted);font-size:.78rem;font-weight:500}
.topactions{display:flex;align-items:center;gap:10px}
.iconbtn{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;border:1px solid var(--line2);color:var(--text);background:var(--surface)}
.avatar{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--lime),#7fd400);color:var(--limeink);font-weight:800;font-size:.85rem}
main{padding:20px 16px 110px;max-width:1240px}
@media(min-width:960px){
  .shell{display:grid;grid-template-columns:256px 1fr;background:linear-gradient(90deg,rgba(15,16,16,.7) 255px,var(--line) 255px,var(--line) 256px,transparent 256px)}
  .side{display:flex;flex-direction:column;position:sticky;top:0;height:100vh;padding:22px 14px;}
  .topbar{padding:18px 36px}
  main{padding:28px 36px 64px}
  .tabs{display:none!important}
}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-size:1.25rem;font-weight:600;letter-spacing:-.02em;padding:2px 10px 18px}
.brand b{font-weight:800}.brand.big{font-size:1.6rem;padding:0 0 22px;justify-content:center}
.mark{width:26px;height:26px;border-radius:9px;background:var(--lime);box-shadow:0 0 24px var(--limeglow);position:relative}
.mark:after{content:"";position:absolute;inset:7px;border-radius:50%;background:var(--limeink)}
.nav{display:flex;flex-direction:column;gap:2px;flex:1;overflow:auto}
.navhead{margin:16px 12px 6px;color:var(--dim);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.nav a,.sheet a,.navbtn{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;color:var(--muted);text-decoration:none;font-weight:500;transition:background .15s,color .15s}
.nav a:hover,.sheet a:hover,.navbtn:hover{background:var(--surface2);color:var(--text)}
.nav a.on,.sheet a.on{background:var(--limesoft);color:var(--lime);box-shadow:inset 0 0 0 1px rgba(198,255,31,.18)}
.navbtn{width:100%;justify-content:flex-start;background:none;border:0;font:inherit;cursor:pointer;font-weight:500}.navbtn:hover{box-shadow:none}
.me{display:flex;align-items:center;gap:10px;padding:12px;margin:10px 0 6px;border-radius:var(--r2);background:var(--surface);border:1px solid var(--line)}
.me b{display:block;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.me span{color:var(--muted);font-size:.78rem}.me div{min-width:0}
.switch{display:flex;gap:6px;margin:0 0 6px}.switch select{padding:8px}

/* Phone tab bar */
.tabs{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:30;display:flex;justify-content:space-around;padding:6px;border-radius:22px;background:rgba(22,23,23,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--line2);box-shadow:0 12px 40px rgba(0,0,0,.5)}
.tabs>a,.moretab>summary{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 2px;border-radius:16px;color:var(--muted);text-decoration:none;font-size:.68rem;font-weight:600;cursor:pointer;list-style:none}
.moretab{flex:1;display:flex}.moretab>summary::-webkit-details-marker{display:none}
.tabs>a.on,.moretab.on>summary{color:var(--limeink);background:var(--lime)}
.sheet{position:absolute;left:0;right:0;bottom:calc(100% + 10px);padding:10px;border-radius:20px;background:#161717;border:1px solid var(--line2);box-shadow:0 20px 60px rgba(0,0,0,.6)}
.sheethead{color:var(--muted);font-size:.8rem;margin:4px 12px 8px}

/* Cards and numbers */
.card,.stat,.column{background:var(--glass),var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:18px}
.card.glow,.stat.glow{background:radial-gradient(120% 120% at 100% 0%,rgba(198,255,31,.16),transparent 55%),var(--glass),var(--surface);border-color:rgba(198,255,31,.18)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr))}
.split{display:grid;gap:14px}@media(min-width:1100px){.split{grid-template-columns:1.6fr 1fr}.split.even{grid-template-columns:1fr 1fr}}
.stathead{display:flex;justify-content:space-between;align-items:center;gap:8px}
.staticon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--surface3);color:var(--muted)}
.glow .staticon{background:var(--lime);color:var(--limeink)}
.stat .label,.label{color:var(--muted);font-size:.8rem;font-weight:500;margin:0}
.stat .value,.value{font-size:1.75rem;font-weight:700;letter-spacing:-.03em;margin:10px 0 6px;line-height:1.1}
.note{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;color:var(--muted);font-size:.8rem}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:.74rem;font-weight:700;padding:2px 8px;border-radius:99px}
.pill.up{background:var(--limesoft);color:var(--lime)}.pill.down{background:var(--redsoft);color:var(--red)}
.cardhead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}.cardhead h2,.cardhead h3{margin:0}
.cardhead a{font-size:.84rem;font-weight:600;text-decoration:none;display:inline-flex;gap:4px;align-items:center}

/* Rings, meters, bars */
.ring{--p:0;width:132px;height:132px;border-radius:50%;flex:none;display:grid;place-items:center;background:conic-gradient(var(--lime) calc(var(--p)*1%),var(--surface3) 0);box-shadow:0 0 30px rgba(198,255,31,.08)}
.ring.hot{background:conic-gradient(var(--red) calc(var(--p)*1%),var(--surface3) 0)}
.ring>div{width:104px;height:104px;border-radius:50%;background:var(--surface);display:grid;place-content:center;text-align:center}
.ring b{font-size:1.2rem;letter-spacing:-.02em}.ring span{color:var(--muted);font-size:.68rem;line-height:1.25;max-width:78px;margin:2px auto 0}
.rings{display:flex;flex-wrap:wrap;gap:22px;align-items:center;justify-content:space-around}
.meter{height:8px;background:var(--surface3);border-radius:99px;overflow:hidden;margin-top:8px}.meter span{display:block;height:100%;background:linear-gradient(90deg,var(--lime2),var(--lime));border-radius:99px}.meter.hot span{background:var(--red)}
.chart{display:grid;grid-template-columns:repeat(14,1fr);gap:6px;align-items:end;height:210px;padding-top:26px}
.chart .col{display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.chart .barw{width:100%;flex:1;display:flex;align-items:flex-end;border-radius:10px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 6px,transparent 6px 12px)}
.chart .bar{width:100%;border-radius:10px;background:linear-gradient(180deg,#3a3c3a,#262827);min-height:4px;position:relative}
.chart .bar.top{background:linear-gradient(180deg,var(--lime),var(--lime2));box-shadow:0 0 24px rgba(198,255,31,.3)}
.chart .bar.today{box-shadow:inset 0 0 0 1.5px var(--lime)}
.chart .bar b{position:absolute;top:-24px;left:50%;transform:translateX(-50%);font-size:.72rem;color:var(--text);white-space:nowrap}
.chart .day{font-size:.68rem;color:var(--dim)}
@media(max-width:600px){.chart{gap:3px;height:150px}.chart .day{font-size:.58rem}.chart .bar b{display:none}.chart .bar.top b{display:block}}

/* Lists and tables */
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:.74rem;text-transform:uppercase;letter-spacing:.06em}
tr:last-child td{border-bottom:0}
.scroll{overflow-x:auto;background:var(--glass),var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:4px 8px}
.rank{display:grid;gap:14px}
.rank li{list-style:none}.rank{margin:0;padding:0}
.rankrow{display:flex;justify-content:space-between;gap:10px;font-size:.9rem}.rankrow b{font-weight:600}
.tiles{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.tile{display:flex;flex-direction:column;gap:4px;padding:16px;border-radius:var(--r2);background:var(--surface2);border:1px solid var(--line);color:var(--text);text-decoration:none;transition:border-color .15s,transform .15s}
.tile:hover{border-color:var(--line2);transform:translateY(-1px)}
.tile b{font-size:1.6rem;letter-spacing:-.02em}.tile span{color:var(--muted);font-size:.82rem}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:6px;vertical-align:middle}
.dot.lime{background:var(--lime);box-shadow:0 0 10px var(--limeglow)}.dot.amber{background:var(--amber)}.dot.red{background:var(--red)}.dot.blue{background:var(--blue)}

/* Forms and buttons */
form{margin:0}label{display:block;font-weight:500;font-size:.88rem;margin:14px 0 6px}label .muted{font-weight:400}
input,select,textarea{width:100%;font:inherit;color:var(--text);background:var(--bg2);border:1px solid var(--line2);border-radius:12px;padding:11px 13px;transition:border-color .15s,box-shadow .15s}
input::placeholder,textarea::placeholder{color:var(--dim)}
input[type=checkbox]{width:auto}input[type=file]{padding:9px}input[type=color]{padding:4px;height:46px}
textarea{min-height:100px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:0;border-color:rgba(198,255,31,.6);box-shadow:0 0 0 4px rgba(198,255,31,.12)}
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--lime);color:var(--limeink);border:0;border-radius:12px;padding:11px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;transition:transform .12s,box-shadow .15s,background .15s}
button:hover,.button:hover{box-shadow:0 6px 24px rgba(198,255,31,.25)}button:active,.button:active{transform:translateY(1px)}
button:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
button.ghost,.button.ghost{background:var(--surface2);color:var(--text);border:1px solid var(--line2)}
button.ghost:hover,.button.ghost:hover{background:var(--surface3);box-shadow:none}
button.danger{background:transparent;color:var(--red);border:1px solid rgba(255,122,107,.3)}button.danger:hover{background:var(--redsoft);box-shadow:none}
button.small,.button.small{padding:7px 12px;font-size:.82rem;border-radius:10px}
:focus-visible{outline:2px solid var(--lime);outline-offset:2px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.row>*{flex:1 1 160px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
fieldset{border:0;margin:0;padding:0}legend{padding:0}
details>summary{cursor:pointer}
details.card>summary{list-style:none;font-weight:600}details.card>summary::-webkit-details-marker{display:none}
details.card>summary:before{content:"+";display:inline-grid;place-items:center;width:24px;height:24px;margin-right:10px;border-radius:8px;background:var(--limesoft);color:var(--lime);font-weight:800}
details.card[open]>summary:before{content:"–"}
.flash{padding:12px 16px;border-radius:var(--r2);margin:0 0 18px;font-weight:500;border:1px solid}
.good{background:var(--limesoft);color:var(--lime);border-color:rgba(198,255,31,.22)}.bad{background:var(--redsoft);color:var(--red);border-color:rgba(255,122,107,.25)}
.flash ul{margin:6px 0 0;padding-left:20px}
.tag{display:inline-flex;align-items:center;font-size:.72rem;font-weight:600;padding:3px 9px;border-radius:99px;background:var(--surface3);color:var(--muted)}
.tag.lime{background:var(--limesoft);color:var(--lime)}.tag.red{background:var(--redsoft);color:var(--red)}.tag.amber{background:var(--ambersoft);color:var(--amber)}.tag.blue{background:var(--bluesoft);color:var(--blue)}

/* Dashboard hero */
.hero{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px}
.hero h2{font-size:1.5rem;margin:0 0 4px;letter-spacing:-.02em}.hero p{margin:0;color:var(--muted)}
.quick{display:flex;gap:8px;flex-wrap:wrap}

/* Order board */
.board{display:grid;gap:14px;grid-template-columns:1fr}
@media(min-width:700px){.board{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:1280px){.board{grid-template-columns:repeat(5,minmax(0,1fr))}}
.column{padding:12px;border-radius:var(--r)}
.column h3{display:flex;align-items:center;justify-content:space-between;font-size:.88rem;margin:4px 4px 2px}
.column h3 .count{font-size:.74rem;color:var(--muted);background:var(--surface3);padding:1px 8px;border-radius:99px}
.column>.muted{margin:0 4px 10px}
.column ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.order{background:var(--surface2);border:1px solid var(--line);border-radius:var(--r2);padding:12px;transition:border-color .15s}
.order:hover{border-color:var(--line2)}
.order .top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.order .who{display:flex;align-items:center;gap:8px;margin:8px 0 4px;font-weight:500;font-size:.9rem}
.order .who .avatar{width:26px;height:26px;font-size:.66rem}
.order .actions{margin-top:12px;display:grid;gap:6px}.order .actions button{width:100%;padding:8px 6px}

/* Inbox */
.list{background:var(--glass),var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.chatrow{display:flex;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);color:var(--text);text-decoration:none;transition:background .15s}
.chatrow:last-child{border-bottom:0}.chatrow:hover{background:var(--surface2)}
.chatrow .avatar{background:var(--surface3);color:var(--text)}.chatrow.new .avatar{background:linear-gradient(135deg,var(--lime),#7fd400);color:var(--limeink)}
.chatrow .body{flex:1;min-width:0}.chatrow .line1{display:flex;justify-content:space-between;gap:8px}
.chatrow .preview{display:block;color:var(--muted);font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat{display:flex;flex-direction:column;gap:10px;padding:18px;margin-bottom:16px;border-radius:var(--r);background:var(--bg2);border:1px solid var(--line);background-image:radial-gradient(rgba(255,255,255,.03) 1px,transparent 1px);background-size:18px 18px}
.bubble{max-width:78%;padding:10px 14px;border-radius:16px 16px 16px 4px;background:var(--surface3);white-space:pre-wrap;word-wrap:break-word;font-size:.92rem}
.bubble.out{align-self:flex-end;border-radius:16px 16px 4px 16px;background:#24310a;border:1px solid rgba(198,255,31,.14)}
.bubble.staff{background:#10283a;border-color:rgba(124,182,255,.2)}
.bubble .muted{display:block;font-size:.7rem;margin-top:5px;text-align:right}

/* Search and toolbars */
.search{display:flex;gap:8px;margin:0 0 16px;max-width:560px}.search input{flex:1}
.toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:10px}.toolbar .search{flex:1 1 300px}
.board{align-items:start}

/* Price list and misc */
.product .price{color:var(--lime);font-weight:700;margin:2px 0 6px;font-size:.95rem}
.product{display:flex;gap:14px;align-items:center;text-decoration:none;color:inherit;transition:border-color .15s,transform .15s}
.product:hover{border-color:var(--line2);transform:translateY(-1px)}
.thumb{width:68px;height:68px;flex:none;object-fit:cover;border-radius:14px;background:var(--surface3);display:grid;place-items:center;color:var(--dim);font-weight:800;font-size:1.2rem}
.tiers{background:transparent;border:0;padding:0}.tiers td,.tiers th{padding:4px 6px 4px 0;border:0}.tiers input{padding:9px 11px}
.steps{counter-reset:s;list-style:none;padding:0;display:grid;gap:10px}
.steps li{counter-increment:s;padding:14px 16px 14px 58px;position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--r2)}
.steps li:before{content:counter(s);position:absolute;left:16px;top:13px;width:28px;height:28px;border-radius:9px;background:var(--lime);color:var(--limeink);font-weight:800;text-align:center;line-height:28px}
details.faq{border-bottom:1px solid var(--line);padding:14px 2px}details.faq summary{font-weight:600}details.faq p{color:var(--muted);margin:8px 0 0}
.bars{display:flex;align-items:flex-end;gap:4px;height:120px}.bars span{flex:1;background:var(--lime);border-radius:4px 4px 0 0}

/* Login */
.auth{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;
  background:radial-gradient(600px 400px at 50% 0%,rgba(198,255,31,.12),transparent 70%)}
.authcard{width:100%;max-width:420px;padding:32px 26px;border-radius:26px;background:var(--glass),var(--surface);border:1px solid var(--line2);box-shadow:0 30px 80px rgba(0,0,0,.45)}
.authcard h1{font-size:1.45rem;text-align:center;margin-bottom:8px}.authcard h2{font-size:1rem}
.authcard form button{width:100%;margin-top:6px;padding:13px}
.authfoot{color:var(--dim);font-size:.8rem;margin-top:18px}.authfoot a{color:var(--muted)}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/** Reads a form field as trimmed text, at most `max` characters. */
export function field(form: Record<string, unknown>, name: string, max = 500): string {
  const v = form[name];
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
