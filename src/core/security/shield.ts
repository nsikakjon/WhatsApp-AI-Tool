import type { Context, MiddlewareHandler } from "hono";

// Screen shield for pages with customer details and money on them (owner app,
// staff inbox, dashboard). A web page can't stop a phone taking a screenshot,
// so this does what a page can:
//   - shows money amounts and phone numbers as •••• until the eye button is
//     pressed, and hides them again when you switch to another app or tab;
//     printing gives a blank page;
//   - lays a faint "who · when" watermark over the page, so a leaked
//     screenshot shows whose screen it came from;
//   - tells the browser not to keep a copy, so Back after logging out on a
//     shared phone shows nothing.
// Switched on with SCREEN_SHIELD.

const EYE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="shut" d="M4 4l16 16"/></svg>`;

const CSS = `
#shield-eye{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483646;width:48px;height:48px;border-radius:50%;border:1px solid rgba(128,128,128,.35);background:rgba(20,24,22,.92);color:#f3f1e6;display:grid;place-items:center;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35)}
#shield-eye[aria-pressed="true"] .shut{display:none}
.sv{white-space:nowrap}
#shield-mark{position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:.07}
@media print{body{display:none}}`;

// Money as the app writes it (₦12,500, $5.50, GH₵70, KSh 850, 3 500 FCFA) and
// phone numbers (+234 803 123 4567, 2348031234567, 08031234567). Pressing the
// eye shows them on every page in that tab; leaving the tab (another app, the
// recent apps screen) hides them on screen again until the eye is pressed.
const SCRIPT = `(()=>{
const pat=/(?:[₦$]|GH₵|KSh\\s?|NGN\\s?)\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\d{1,3}(?:[ \\u00a0]\\d{3})*(?:,\\d{2})?[ \\u00a0]FCFA|\\+\\d{1,3}[ -]?\\d[\\d -]{6,13}\\d|\\b(?:2\\d{11,12}|0[789][01]\\d{8})\\b/g;
const skip=new Set(["SCRIPT","STYLE","TEXTAREA","OPTION","SELECT","TITLE","NOSCRIPT"]);
const nodes=[],walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
for(let n;(n=walk.nextNode());){const p=n.parentElement;if(p&&!skip.has(p.tagName)&&!p.closest("svg,.sv")&&(pat.lastIndex=0,pat.test(n.data)))nodes.push(n)}
const spans=[];
for(const n of nodes){const f=document.createDocumentFragment();let last=0;pat.lastIndex=0;
for(const m of n.data.matchAll(pat)){f.append(n.data.slice(last,m.index));const s=document.createElement("span");s.className="sv";s.dataset.v=m[0];spans.push(s);f.append(s);last=m.index+m[0].length}
f.append(n.data.slice(last));n.replaceWith(f)}
if(!spans.length)return;
const eye=document.createElement("button");eye.id="shield-eye";eye.type="button";eye.innerHTML=${JSON.stringify(EYE)};
const tabs=document.querySelector(".tabs");
if(tabs&&tabs.offsetParent)eye.style.bottom="calc("+(tabs.offsetHeight+22)+"px + env(safe-area-inset-bottom))";
const set=(show,keep)=>{for(const s of spans)s.textContent=show?s.dataset.v:"••••";eye.setAttribute("aria-pressed",show);eye.setAttribute("aria-label",show?"Hide amounts and numbers":"Show amounts and numbers");eye.title=eye.getAttribute("aria-label");if(keep)return;if(show)sessionStorage.setItem("shield-show","1");else sessionStorage.removeItem("shield-show")};
eye.onclick=()=>set(eye.getAttribute("aria-pressed")!=="true");
document.body.append(eye);
set(sessionStorage.getItem("shield-show")==="1");
document.addEventListener("visibilitychange",()=>{if(document.hidden)set(false,true)});
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
