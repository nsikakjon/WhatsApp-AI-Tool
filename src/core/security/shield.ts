import type { Context, MiddlewareHandler } from "hono";

// Screen shield for pages with customer details and money on them (owner app,
// staff inbox, dashboard). A web page can't stop a phone taking a screenshot,
// so this does what a page can:
//   - blurs everything when the page loses focus (switching apps, the recent
//     apps screen, many screenshot tools), and blanks it when printed;
//   - hides money amounts and phone numbers until someone taps them;
//   - lays a faint "who · when" watermark over the page, so a leaked
//     screenshot shows whose screen it came from;
//   - tells the browser not to keep a copy, so Back after logging out on a
//     shared phone shows nothing.
// Switched on with SCREEN_SHIELD.

const CSS = `
html.shield-away body{filter:blur(22px)}
.sv{cursor:pointer;border-radius:4px;transition:filter .15s}
.sv:not(.shown){filter:blur(6px);user-select:none;-webkit-user-select:none}
#shield-mark{position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:.07}
@media print{body{display:none}}`;

// Money as the app writes it (₦12,500, $5.50, GH₵70, KSh 850, 3 500 FCFA) and
// phone numbers (+234 803 123 4567, 2348031234567, 08031234567).
const SCRIPT = `(()=>{
const pat=/(?:[₦$]|GH₵|KSh\\s?|NGN\\s?)\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\d{1,3}(?:[ \\u00a0]\\d{3})*(?:,\\d{2})?[ \\u00a0]FCFA|\\+\\d{1,3}[ -]?\\d[\\d -]{6,13}\\d|\\b(?:2\\d{11,12}|0[789][01]\\d{8})\\b/g;
const skip=new Set(["SCRIPT","STYLE","TEXTAREA","OPTION","SELECT","TITLE","NOSCRIPT"]);
const nodes=[],walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
for(let n;(n=walk.nextNode());){const p=n.parentElement;if(p&&!skip.has(p.tagName)&&!p.closest("svg,.sv")&&(pat.lastIndex=0,pat.test(n.data)))nodes.push(n)}
for(const n of nodes){const f=document.createDocumentFragment();let last=0;pat.lastIndex=0;
for(const m of n.data.matchAll(pat)){f.append(n.data.slice(last,m.index));const s=document.createElement("span");s.className="sv";s.tabIndex=0;s.title="Tap to show";s.textContent=m[0];f.append(s);last=m.index+m[0].length}
f.append(n.data.slice(last));n.replaceWith(f)}
const tap=e=>{const s=e.target.closest&&e.target.closest(".sv");if(!s)return;if(!s.classList.contains("shown")){e.preventDefault();e.stopPropagation()}s.classList.toggle("shown")};
document.addEventListener("click",tap,true);
document.addEventListener("keydown",e=>{if(e.key==="Enter")tap(e)});
const root=document.documentElement;
const away=()=>{root.classList.add("shield-away");document.querySelectorAll(".sv.shown").forEach(s=>s.classList.remove("shown"))};
addEventListener("blur",away);addEventListener("pagehide",away);
document.addEventListener("visibilitychange",()=>{if(document.hidden)away()});
addEventListener("focus",()=>root.classList.remove("shield-away"));
})();`;

function xml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The watermark: the text repeated in slanted rows, as an SVG background. */
function watermark(text: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="190"><text x="10" y="120" transform="rotate(-24 170 95)" font-family="Arial,sans-serif" font-size="15" fill="#888">${xml(text)}</text></svg>`;
  return `<div id="shield-mark" aria-hidden="true" style="background-image:url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}')"></div>`;
}

/** "31 Oct 2026, 19:05" in Lagos time. */
function lagosTime(now: Date): string {
  return now.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Adds the shield to a page's HTML. */
export function shieldHtml(html: string, viewer: string, now = new Date()): string {
  const head = `<style>${CSS}</style>`;
  const tail = `${watermark(`${viewer} · ${lagosTime(now)}`)}<script>${SCRIPT}</script>`;
  const withHead = html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : head + html;
  return withHead.includes("</body>") ? withHead.replace(/<\/body>(?![\s\S]*<\/body>)/, `${tail}</body>`) : withHead + tail;
}

/**
 * Puts the shield on every page under a path. `viewer` names who is looking,
 * for the watermark; it runs after the page is made, so it can read what the
 * page's login check found.
 */
export function screenShield(viewer: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("Pragma", "no-cache");
    const type = c.res.headers.get("content-type");
    if (!type?.includes("text/html")) return;
    const html = shieldHtml(await c.res.text(), viewer(c));
    // Hono carries the other headers (cookies included) over to the new response.
    c.res.headers.delete("content-length");
    c.res = new Response(html, { status: c.res.status, headers: { "content-type": type } });
  };
}
