import { mark } from "./brand.js";

/**
 * The look of yarnOga's own pages (analytics dashboard, plan editor, quote bot
 * setup): header with the mark, jump links and styles. `heading`, `nav` and
 * `css` (extra styles for the page) are HTML/CSS; the rest is text.
 */
export function pageShell(o: { title: string; crumb: string; heading: string; badge?: string; nav: string; body: string; css?: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0a0d0b">
<title>${esc(o.title)}</title>
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
.entry .wide-all, .entry .ticks { grid-column:1 / -1; }
.ticks { display:flex; flex-wrap:wrap; gap:8px 24px; }
.entry label.tick { flex-direction:row; align-items:center; gap:8px; color:var(--text); }
.entry input[type=checkbox] { width:18px; height:18px; padding:0; accent-color:var(--lime); }
.features { max-width:none; min-width:520px; }
.features td { padding:6px 14px; }
.features input:not([type=checkbox]) { width:120px; }
form.plan + form.plan { margin-top:12px; }
main > .problem:first-child { margin-top:24px; }
.saved { padding:14px 18px; margin:24px 0 0; border-radius:14px; background:var(--limesoft); color:var(--lime); }
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
${o.css ?? ""}
</style></head>
<body>
<header>
${mark("m", 48)}
<div class="titles">
<p class="crumb">${esc(o.crumb)}</p>
<h1>${o.heading}</h1>
</div>
${o.badge ? `<span class="fresh">${esc(o.badge)}</span>` : ""}
</header>
<nav class="jump" aria-label="Sections"><div>${o.nav}</div></nav>
<main>
${o.body}
</main></body></html>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
