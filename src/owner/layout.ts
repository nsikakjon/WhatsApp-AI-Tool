import type { Role } from "./store.js";

// The owner app's look: one page shell with a menu, in yarnOga's colours,
// that works on a phone first. Plain HTML forms, no JavaScript needed, so it
// works on any phone browser and slow connections.

export function esc(text: string | null | undefined): string {
  return (text ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Only owners see it. */
  ownerOnly?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: "◧" },
  { href: "/app/inbox", label: "Inbox", icon: "✉" },
  { href: "/app/orders", label: "Orders", icon: "▤" },
  { href: "/app/prices", label: "Price list", icon: "₦" },
  { href: "/app/delivery", label: "Riders & delivery", icon: "➜" },
  { href: "/app/test", label: "Test your bot", icon: "✦" },
  { href: "/app/posters", label: "QR posters", icon: "▣" },
  { href: "/app/export", label: "Export", icon: "⇩", ownerOnly: true },
  { href: "/app/settings", label: "Settings", icon: "⚙", ownerOnly: true },
  { href: "/app/help", label: "Help", icon: "?" },
  { href: "/app/status", label: "Status", icon: "●" },
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

export function page(s: Shell, body: string): string {
  const nav = NAV.filter((n) => !n.ownerOnly || s.role === "owner")
    .map(
      (n) =>
        `<a href="${n.href}"${n.href === s.active ? ' class="on" aria-current="page"' : ""}><span class="i" aria-hidden="true">${n.icon}</span>${n.label}</a>`,
    )
    .join("");
  const switcher = s.others?.length
    ? `<form method="post" action="/app/switch" class="switch"><select name="user" aria-label="Switch business">${[
        `<option value="">${esc(s.businessName)}</option>`,
        ...s.others.map((o) => `<option value="${o.userId}">${esc(o.name)}</option>`),
      ].join("")}</select><button class="ghost small">Switch</button></form>`
    : "";
  const flash = s.flash ? `<p class="flash ${s.flash.ok ? "good" : "bad"}" role="status">${esc(s.flash.text)}</p>` : "";
  return doc(
    s.title,
    `<header class="top"><a class="brand" href="/app"><span class="dot"></span>${esc(s.businessName)}</a>
<details class="menu"><summary aria-label="Menu">Menu</summary><nav>${nav}</nav></details></header>
<div class="wrap"><aside class="side"><nav>${nav}</nav>${switcher}
<p class="who">${esc(s.userName)} · ${s.role === "owner" ? "Owner" : "Staff"}</p>
<form method="post" action="/app/logout"><button class="ghost small">Log out</button></form></aside>
<main><h1>${esc(s.title)}</h1>${flash}${body}</main></div>`,
  );
}

/** A page with no menu: login and link pages. */
export function bare(title: string, body: string): string {
  return doc(title, `<main class="narrow"><p class="brand big"><span class="dot"></span>yarnOga</p>${body}</main>`);
}

function doc(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="theme-color" content="#0c0d0d"><title>${esc(title)} · yarnOga</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23c6ff1f'/%3E%3C/svg%3E">
<style>${CSS}</style></head><body>${body}</body></html>`;
}

/** A number box: label, value, and an optional line under it. */
export function stat(label: string, value: string, note = ""): string {
  return `<div class="stat"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p>${note ? `<p class="muted small">${esc(note)}</p>` : ""}</div>`;
}

/** A bar for "used x of y". */
export function meter(used: number, limit: number | null): string {
  if (limit == null || limit <= 0) return "";
  const pct = Math.min(100, Math.round((used * 100) / limit));
  return `<div class="meter${pct >= 90 ? " hot" : ""}" role="img" aria-label="${pct}% used"><span style="width:${pct}%"></span></div>`;
}

const CSS = `
:root{--bg:#0c0d0d;--panel:#151616;--card:#1d1e1e;--line:#2e302f;--text:#f3f4ef;--muted:#9a9d97;--lime:#c6ff1f;--red:#ff8a80;--green:#7ee08a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--lime)}h1{font-size:1.5rem;margin:.1em 0 .7em}h2{font-size:1.1rem;margin:1.8em 0 .6em}h3{font-size:1rem;margin:0 0 .4em}
p{margin:0 0 .6em}.muted{color:var(--muted)}.small{font-size:.86rem}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;color:var(--text);text-decoration:none;font-weight:800}.brand.big{font-size:1.4rem;margin-bottom:1em}
.dot{width:12px;height:12px;border-radius:50%;background:var(--lime);display:inline-block}
.menu summary{cursor:pointer;list-style:none;padding:6px 12px;border:1px solid var(--line);border-radius:8px}.menu summary::-webkit-details-marker{display:none}
.menu nav{position:absolute;right:16px;top:52px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px;min-width:220px}
nav a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:8px;color:var(--text);text-decoration:none}
nav a:hover{background:var(--card)}nav a.on{background:var(--card);color:var(--lime);font-weight:700}.i{width:1.2em;text-align:center;color:var(--muted)}
.wrap{display:flex;max-width:1280px;margin:0 auto}.side{display:none}
main{flex:1;min-width:0;padding:20px 16px 64px}main.narrow{max-width:440px;margin:0 auto;padding-top:48px}
@media(min-width:900px){.menu{display:none}.side{display:block;width:240px;flex:none;padding:20px 12px;border-right:1px solid var(--line);min-height:calc(100vh - 53px)}main{padding:24px 32px 64px}}
.who{margin:18px 10px 6px;color:var(--muted);font-size:.86rem}.switch{margin:14px 10px;display:flex;gap:6px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.stat,.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.stat .label{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;margin:0}.stat .value{font-size:1.5rem;font-weight:800;margin:2px 0}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:.86rem}
.scroll{overflow-x:auto}
form{margin:0}label{display:block;font-weight:600;margin:12px 0 4px}label .muted{font-weight:400}
input,select,textarea{width:100%;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px}
input[type=checkbox]{width:auto}input[type=file]{padding:8px}textarea{min-height:90px}
input:focus,select:focus,textarea:focus{outline:2px solid var(--lime);outline-offset:1px}
button,.button{display:inline-block;background:var(--lime);color:#0c0d0d;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
button.ghost,.button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}button.danger{background:transparent;color:var(--red);border:1px solid #5a2a2a}
.small{font-size:.86rem}button.small,.button.small{padding:6px 10px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.row>*{flex:1 1 140px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.flash{padding:10px 14px;border-radius:8px}.good{background:#1c2a05;color:var(--lime)}.bad{background:#3a1010;color:var(--red)}
.tag{display:inline-block;font-size:.75rem;padding:2px 8px;border-radius:99px;background:var(--card);border:1px solid var(--line);color:var(--muted)}
.tag.lime{color:var(--lime);border-color:#4b6010}.tag.red{color:var(--red);border-color:#5a2a2a}
.meter{height:8px;background:var(--card);border-radius:99px;overflow:hidden;margin-top:6px}.meter span{display:block;height:100%;background:var(--lime)}.meter.hot span{background:var(--red)}
.bars{display:flex;align-items:flex-end;gap:4px;height:120px;padding-top:8px}.bars span{flex:1;background:var(--lime);border-radius:3px 3px 0 0;min-height:2px;opacity:.85}
.board{display:grid;gap:12px;grid-template-columns:1fr}@media(min-width:1100px){.board{grid-template-columns:repeat(5,minmax(0,1fr))}}
.column{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}.column ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.order{background:var(--card);border-radius:8px;padding:10px}
.chat{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}.bubble{max-width:80%;padding:8px 12px;border-radius:12px;background:var(--card);white-space:pre-wrap;word-wrap:break-word}
.bubble.out{align-self:flex-end;background:#24310a}.bubble.staff{background:#0f2a3a}.bubble .muted{display:block;font-size:.75rem;margin-top:4px}
.list a.chatrow{display:block;padding:12px;border-bottom:1px solid var(--line);color:var(--text);text-decoration:none}.list a.chatrow:hover{background:var(--panel)}
.thumb{width:64px;height:64px;object-fit:cover;border-radius:8px;background:var(--card)}
.tiers td{padding:4px}.tiers input{padding:7px}
.steps{counter-reset:s;list-style:none;padding:0}.steps li{counter-increment:s;padding:8px 0 8px 40px;position:relative}.steps li:before{content:counter(s);position:absolute;left:0;top:6px;width:28px;height:28px;border-radius:50%;background:var(--lime);color:#0c0d0d;font-weight:800;text-align:center;line-height:28px}
details.faq{border-bottom:1px solid var(--line);padding:10px 0}details.faq summary{cursor:pointer;font-weight:600}
code{background:var(--card);padding:1px 6px;border-radius:5px}
`;

/** Reads a form field as trimmed text, at most `max` characters. */
export function field(form: Record<string, unknown>, name: string, max = 500): string {
  const v = form[name];
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
