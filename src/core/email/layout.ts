// The yarnOga email look Jay approved (Test 3, 29 October 2026): dark header
// with the logo, an optional Pexels photo, white body, lime button and a dark
// footer. Built from tables with bgcolor on every coloured cell, because some
// mail apps (Gmail among them) drop CSS backgrounds. Every email also gets a
// plain-text version.

export const HEROES = {
  welcome: "A smiling woman in Lagos holding her phone",
  chat: "A woman chatting on her phone at home",
  flyers: "A family raising their glasses at a celebration dinner",
  site: "Builders in hard hats on scaffolding",
  property: "A tall apartment building at dusk",
} as const;
export type Hero = keyof typeof HEROES;

/** A paragraph, numbered steps (title and text), a bulleted list, or a dark green note (bold lead and text). */
export type Block = string | { steps: Array<[string, string]> } | { list: string[] } | { note: [string, string] };

export interface EmailContent {
  /** Small green line above the title, e.g. "Quotes and orders". */
  eyebrow: string;
  subject: string;
  /** The grey line mail apps show after the subject. */
  preview: string;
  hero?: Hero;
  blocks: Block[];
  button?: { label: string; href: string };
}

const INK = "#121400";
const TEXT = "#1d211e";
const MUTED = "#5b625c";
const BG = "#ecebe3";
const DARK = "#0a0d0b";
const NEON = "#c6ff1f";
const LEAF = "#3f8f16";
const FOREST = "#0e3b2c";
const FONT = "'Instrument Sans','Segoe UI',Helvetica,Arial,sans-serif";
const HEAD = "'Chakra Petch','Schibsted Grotesk',Arial,sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escaped text with *bold* and links. */
function inline(s: string): string {
  return esc(s)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/https?:\/\/[^\s<]+[^\s<.,)]/g, (url) => `<a href="${url}" style="color:${LEAF}">${url}</a>`);
}
const plain = (s: string) => s.replace(/\*([^*\n]+)\*/g, "$1");

function blockHtml(b: Block): string {
  if (typeof b === "string") return `<p style="margin:0 0 16px;font:16px/1.6 ${FONT};color:${TEXT}">${inline(b)}</p>`;
  if ("steps" in b) {
    const rows = b.steps
      .map(
        ([title, body], i) => `<tr><td valign="top" style="padding:0 14px 18px 0;width:34px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="34" height="34" align="center" valign="middle" bgcolor="${DARK}" style="width:34px;height:34px;background-color:${DARK};color:${NEON};border-radius:6px;font:700 16px/34px ${HEAD};mso-line-height-rule:exactly">${i + 1}</td></tr></table></td>
<td valign="top" style="padding:0 0 18px"><div style="font:700 16px/1.4 ${FONT};color:${INK}">${inline(title)}</div><div style="font:15px/1.55 ${FONT};color:${TEXT};margin-top:2px">${inline(body)}</div></td></tr>`,
      )
      .join("");
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px">${rows}</table>`;
  }
  if ("list" in b) {
    const items = b.list.map((t) => `<li style="margin:0 0 8px">${inline(t)}</li>`).join("");
    return `<ul style="margin:0 0 16px;padding-left:22px;font:16px/1.55 ${FONT};color:${TEXT}">${items}</ul>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td bgcolor="${FOREST}" style="background-color:${FOREST};border-radius:6px;padding:16px 18px;font:15px/1.55 ${FONT};color:#f3f1e6"><span style="color:${NEON};font-weight:700">${inline(b.note[0])}</span> ${inline(b.note[1])}</td></tr></table>`;
}

function blockText(b: Block): string {
  if (typeof b === "string") return plain(b);
  if ("steps" in b) return b.steps.map(([title, body], i) => `${i + 1}. ${plain(title)}: ${plain(body)}`).join("\n");
  if ("list" in b) return b.list.map((t) => `- ${plain(t)}`).join("\n");
  return `${plain(b.note[0])} ${plain(b.note[1])}`.trim();
}

export function renderEmail(e: EmailContent, opts: { imageBase: string; unsubscribeUrl: string }): { html: string; text: string } {
  const img = (file: string) => `${opts.imageBase}/${file}`;
  const button = e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px"><tr><td bgcolor="${NEON}" style="background-color:${NEON};border-radius:6px"><a href="${esc(e.button.href)}" style="display:inline-block;padding:14px 22px;font:700 16px/1.2 ${FONT};color:${INK};text-decoration:none">${esc(e.button.label)} &rarr;</a></td></tr></table>`
    : "";
  const hero = e.hero
    ? `<tr><td bgcolor="${DARK}" style="background-color:${DARK};padding:0"><img src="${img(`hero-${e.hero}.jpg`)}" width="600" alt="${esc(HEROES[e.hero])}" style="display:block;width:100%;height:auto;border:0"></td></tr>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(e.subject)}</title></head>
<body bgcolor="${BG}" style="margin:0;padding:0;background-color:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(e.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background-color:${BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td bgcolor="${DARK}" style="background-color:${DARK};border-radius:8px 8px 0 0;padding:18px 28px"><img src="${img("logo.png")}" width="132" height="60" alt="yarnOga" style="display:block;border:0"></td></tr>
${hero}
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:32px 32px 8px">
<div style="font:600 12px/1 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${LEAF};margin-bottom:12px">${esc(e.eyebrow)}</div>
<h1 style="margin:0 0 20px;font:700 30px/1.15 ${HEAD};letter-spacing:-0.02em;color:${INK}">${esc(e.subject)}</h1>
${e.blocks.map(blockHtml).join("\n")}
${button}
<p style="margin:0 0 4px;font:16px/1.5 ${FONT};color:${TEXT}">Nsikak John</p>
<p style="margin:0 0 28px;font:14px/1.5 ${FONT};color:${MUTED}">yarnOga</p>
</td></tr>
<tr><td bgcolor="${DARK}" style="background-color:${DARK};border-radius:0 0 8px 8px;padding:22px 28px;font:13px/1.6 ${FONT};color:#a9b0a8">
Questions? Reply to this email or write to <a href="mailto:support@yarnoga.com" style="color:${NEON}">support@yarnoga.com</a>. A person reads every message.<br><br>
You're getting this because you asked for yarnOga tips. <a href="${esc(opts.unsubscribeUrl)}" style="color:#f3f1e6">Unsubscribe</a> or send <b style="color:#f3f1e6">stop emails</b> to your yarnOga number.<br>
yarnOga is a product of Kahn Digital Company Ltd, RC 1601716.${e.hero ? " Photo from Pexels." : ""}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    ...e.blocks.map(blockText),
    ...(e.button ? [`${e.button.label}: ${e.button.href}`] : []),
    "Nsikak John\nyarnOga",
    "---",
    "Questions? Reply to this email or write to support@yarnoga.com. A person reads every message.",
    `You're getting this because you asked for yarnOga tips. Unsubscribe: ${opts.unsubscribeUrl} or send "stop emails" to your yarnOga number.`,
    "yarnOga is a product of Kahn Digital Company Ltd, RC 1601716.",
  ].join("\n\n");
  return { html, text };
}
