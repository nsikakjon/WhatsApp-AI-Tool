// yarnOga's own WhatsApp alerts (new sign-ups, numbers to connect) as a
// branded email: the kind of alert, the business in large type, the key facts
// picked out as tiles, a WhatsApp button for the person concerned, then the
// whole alert as sent. Same look as the welcome emails (layout.ts).

import { BG, DARK, FONT, FOREST, HEAD, INK, LEAF, MUTED, NEON, TEXT, esc, inline } from "./layout.js";

export interface AlertCard {
  kind: string;
  headline: string;
  facts: Array<[string, string]>;
  /** Digits only, for a wa.me button. */
  waId?: string;
}

const strip = (s: string) => s.replace(/\*([^*\n]+)\*/g, "$1");

/** Picks the alert apart: "New quote bot sign-up: Ada's Shop (cakes), +234..., 12 items, code JAY10. ..." */
export function readAlert(text: string): AlertCard {
  const plain = strip(text).trim();
  const first = plain.split("\n")[0].trim();
  const colon = first.indexOf(": ");
  let kind = "yarnOga alert";
  let headline = first;
  if (colon > 0 && colon <= 50) {
    const rest = first.slice(colon + 2);
    const name = rest.split(/ \(|, |\. |: /)[0].replace(/[.:]$/, "").trim();
    if (name && name.length <= 60) [kind, headline] = [first.slice(0, colon), name];
  }
  // "New number to connect for Ada's Shop: 0803..." names the business before the colon.
  const forName = kind.match(/^(.+?) for (.+)$/);
  if (forName) [kind, headline] = [forName[1], forName[2]];

  const facts: Array<[string, string]> = [];
  const sells = first.match(/\(([^)]{1,80})\)/)?.[1];
  if (sells) facts.push(["Sells", sells]);
  const phone = plain.match(/\+(\d{10,15})\b/)?.[1];
  if (phone) facts.push(["WhatsApp", `+${phone}`]);
  const newNumber = forName ? first.slice(colon + 2).replace(/\.$/, "").trim() : "";
  if (newNumber && /\d/.test(newNumber)) facts.push(["New number", newNumber]);
  const items = plain.match(/\b(\d+) items?\b/)?.[1];
  if (items) facts.push(["Price list", `${items} item${items === "1" ? "" : "s"}`]);
  const code = plain.match(/\bcode ([A-Z0-9][A-Z0-9-]{1,30})\b/)?.[1];
  if (code) facts.push(["Code", code]);
  return { kind, headline, facts, waId: phone };
}

const LAGOS = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export function renderAlertEmail(text: string, opts: { imageBase?: string; now?: Date } = {}): { subject: string; html: string; text: string } {
  const card = readAlert(text);
  const plain = strip(text).trim();
  const when = LAGOS.format(opts.now ?? new Date());
  const facts: Array<[string, string]> = [...card.facts, ["Received", when]];
  const subjectLine = card.headline === plain.split("\n")[0].trim() ? card.headline : `${card.kind}: ${card.headline}`;
  const subject = `yarnOga: ${subjectLine.length > 90 ? `${subjectLine.slice(0, 89)}…` : subjectLine}`;

  const logo = opts.imageBase
    ? `<img src="${esc(opts.imageBase)}/logo.png" width="110" height="50" alt="yarnOga" style="display:block;border:0">`
    : `<span style="font:700 24px/1 ${HEAD};color:#f3f1e6">yarn<span style="color:${NEON}">Oga</span></span>`;
  const tile = ([label, value]: [string, string]) =>
    `<td width="50%" valign="top" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${FOREST}" style="background-color:${FOREST};border-radius:6px;padding:14px 16px">
<div style="font:600 11px/1 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:#9fc9b4">${esc(label)}</div>
<div style="font:700 18px/1.3 ${HEAD};color:${NEON};margin-top:8px;word-break:break-word">${esc(value)}</div></td></tr></table></td>`;
  const rows: string[] = [];
  for (let i = 0; i < facts.length; i += 2) rows.push(`<tr>${tile(facts[i])}${facts[i + 1] ? tile(facts[i + 1]) : '<td width="50%"></td>'}</tr>`);
  const button = card.waId
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td bgcolor="${NEON}" style="background-color:${NEON};border-radius:6px"><a href="https://wa.me/${card.waId}" style="display:inline-block;padding:14px 22px;font:700 16px/1.2 ${FONT};color:${INK};text-decoration:none">Message them on WhatsApp &rarr;</a></td></tr></table>`
    : "";
  const message = strip(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;font:15px/1.6 ${FONT};color:${TEXT}">${inline(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body bgcolor="${BG}" style="margin:0;padding:0;background-color:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(plain.slice(0, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background-color:${BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td bgcolor="${DARK}" style="background-color:${DARK};border-radius:8px 8px 0 0;padding:22px 28px 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>${logo}</td><td align="right" style="font:600 11px/1 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:#a9b0a8">Alert</td></tr></table>
<div style="font:600 12px/1 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${NEON};margin:26px 0 10px">${esc(card.kind)}</div>
<div style="font:700 32px/1.12 ${HEAD};letter-spacing:-0.02em;color:#f3f1e6">${esc(card.headline)}</div>
</td></tr>
<tr><td bgcolor="${DARK}" style="background-color:${DARK};padding:0 22px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:26px 32px 22px">
<div style="font:600 12px/1 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${LEAF};margin-bottom:12px">The alert</div>
${message}${button}
</td></tr>
<tr><td bgcolor="${DARK}" style="background-color:${DARK};border-radius:0 0 8px 8px;padding:18px 28px;font:13px/1.6 ${FONT};color:${MUTED}">
<span style="color:#a9b0a8">A copy of the WhatsApp alert, sent because this address is set as SIGNUP_ALERT_EMAIL.</span>
</td></tr></table></td></tr></table></body></html>`;

  const lines = [plain, "", ...facts.map(([l, v]) => `${l}: ${v}`), ...(card.waId ? [`WhatsApp them: https://wa.me/${card.waId}`] : [])];
  return { subject, html, text: lines.join("\n") };
}

/** Sends each WhatsApp alert it's given as a branded email. */
export function emailedAlert(send: (subject: string, text: string, html: string) => Promise<void>, opts: { imageBase?: string } = {}) {
  return (text: string) => {
    const e = renderAlertEmail(text, opts);
    return send(e.subject, e.text, e.html);
  };
}
