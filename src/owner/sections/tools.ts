import type { Hono } from "hono";
import { askBot, type TestAnswer } from "../../bottest/sandbox.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { ordersCsv, salesReportPdf } from "../exports.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import { renderPoster, renderPosterPdf, safeColour, type Orientation, type PosterLang } from "../posters.js";
import type { AppContext, Env } from "../types.js";

// Test your bot, QR posters, and exports.

const MAX_QUESTION = 500;
const SUGGESTIONS = [
  "How much for 100 of your best seller?",
  "Do you deliver to Lekki?",
  "Send me your price list",
  "What's the cheapest thing you have?",
  "I want to talk to someone",
];

/** "2026-10-01" -> that day's first moment in Lagos (UTC+1). Null when it isn't a date. */
export function lagosMidnight(text: string): Date | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const check = new Date(Date.UTC(y, mo, day));
  // 2026-02-31 rolls over into March: not a real date.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== day) return null;
  return new Date(check.getTime() - 3_600_000);
}

/** "2026-10" -> [first moment of the month, first moment of the next], in Lagos. */
export function lagosMonth(text: string): [Date, Date] | null {
  const m = text.match(/^(\d{4})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return [new Date(Date.UTC(y, mo, 1, -1)), new Date(Date.UTC(y, mo + 1, 1, -1))];
}

export function registerTools(app: Hono<Env>, ctx: SectionContext) {
  for (const path of ["/test", "/posters", "/posters/*"]) app.use(path, async (c, next) => (await ctx.need(c, "tools")) ?? next());

  // ---- Test your bot ----
  const tests = new Map<string, { day: string; count: number }>();
  const perDay = ctx.deps.botTestsPerDay ?? 60;

  const testPage = (c: AppContext, question = "", answer: TestAnswer | null = null, error = "") => {
    const biz = c.get("biz");
    const used = tests.get(biz.id);
    const left = Math.max(0, perDay - (used && used.day === today(ctx.now()) ? used.count : 0));
    const result = answer
      ? `<div class="chat" style="margin-top:16px"><div class="bubble">${esc(question)}<span class="muted">Pretend customer</span></div>
<div class="bubble out">${esc(answer.text || "(no text reply)")}${answer.choices.length ? `\n\nChoices: ${esc(answer.choices.join(" · "))}` : ""}<span class="muted">Your bot${answer.pictures ? ` · ${answer.pictures} picture${answer.pictures === 1 ? "" : "s"}` : ""}${answer.alerts ? ` · ${answer.alerts} alert${answer.alerts === 1 ? "" : "s"} to you (not sent)` : ""}</span></div></div>`
      : "";
    return ctx.render(
      c,
      "Test your bot",
      "/home/test",
      `<p>Ask what a customer would ask and see exactly what your bot replies, using your real price list. Nothing is sent on WhatsApp and no order is saved.</p>
${error ? `<p class="flash bad">${esc(error)}</p>` : ""}
<form method="post" action="/home/test"><label for="q">Customer's message</label><textarea id="q" name="q" maxlength="${MAX_QUESTION}" required>${esc(question)}</textarea>
<div class="actions"><button${biz.testBot ? "" : " disabled"}>Ask</button></div></form>
<p class="muted small">Try: ${SUGGESTIONS.map((s) => `<a href="/home/test?q=${encodeURIComponent(s)}">${esc(s)}</a>`).join(" · ")}</p>
${result}
<p class="muted small">${left} test questions left today. Each is a new pretend customer, so it doesn't remember earlier questions.</p>`,
    );
  };

  app.get("/test", (c) => testPage(c, (c.req.query("q") ?? "").slice(0, MAX_QUESTION)));

  app.post("/test", async (c) => {
    const biz = c.get("biz");
    const question = field(await c.req.parseBody(), "q", MAX_QUESTION);
    if (!question) return testPage(c, "", null, "Type a question first.");
    if (!biz.testBot) return testPage(c, question, null, "Testing isn't available for your business yet.");
    const day = today(ctx.now());
    const used = tests.get(biz.id);
    const count = used && used.day === day ? used.count : 0;
    if (count >= perDay) return testPage(c, question, null, "That's all the test questions for today. Try again tomorrow.");
    tests.set(biz.id, { day, count: count + 1 });
    try {
      return testPage(c, question, await askBot(biz.testBot(), question));
    } catch (err) {
      ctx.log.error("Owner app: bot test failed:", err);
      return testPage(c, question, null, "The bot couldn't answer just now. Please try again in a minute.");
    }
  });

  // ---- QR posters ----
  const posterInput = async (c: AppContext) => {
    const biz = c.get("biz");
    const info = await biz.data.info().catch(() => null);
    const orientation: Orientation = c.req.query("o") === "landscape" ? "landscape" : "portrait";
    const lang: PosterLang = c.req.query("lang") === "fr" ? "fr" : "en";
    return {
      businessName: info?.name ?? biz.name,
      whatsappNumber: info?.whatsappNumber ?? null,
      logo: await biz.logo().catch(() => null),
      tagline: (c.req.query("tagline") ?? "").slice(0, 70) || null,
      colour: safeColour(`#${(c.req.query("colour") ?? "").replace(/^#/, "")}`),
      orientation,
      lang,
    };
  };

  app.get("/posters", async (c) => {
    const p = await posterInput(c);
    if (!p.whatsappNumber) {
      return ctx.render(
        c,
        "QR posters",
        "/home/posters",
        `<p>Posters need the WhatsApp number your customers message. ${c.get("user").role === "owner" ? `<a href="/home/settings">Add it in Settings</a>` : "Ask the owner to add it in Settings"}, then come back.</p>`,
      );
    }
    const qs = (o: Orientation, ext: string) =>
      `/home/posters/poster.${ext}?o=${o}&lang=${p.lang}&colour=${encodeURIComponent(p.colour.slice(1))}${p.tagline ? `&tagline=${encodeURIComponent(p.tagline)}` : ""}`;
    const preview = (o: Orientation) => `<div class="card"><h3>${o === "portrait" ? "Portrait (A4 upright)" : "Landscape (A4 sideways)"}</h3>
<img src="${qs(o, "png")}" alt="${o} poster preview" style="width:100%;border-radius:8px;background:#fff" loading="lazy">
<div class="actions"><a class="button small" href="${qs(o, "pdf")}" download>Download PDF to print</a><a class="button ghost small" href="${qs(o, "png")}" download>Download picture</a></div></div>`;
    return ctx.render(
      c,
      "QR posters",
      "/home/posters",
      `<p>Put these at your counter, door or window. Customers scan the code with their phone camera and a WhatsApp chat with your bot opens, with a greeting already typed.</p>
<form method="get" class="card"><div class="row">
<label>Language<select name="lang"><option value="en"${p.lang === "en" ? " selected" : ""}>English</option><option value="fr"${p.lang === "fr" ? " selected" : ""}>Français</option></select></label>
<label>Colour<input type="color" name="colour" value="${esc(p.colour)}" style="height:44px"></label></div>
<label>Line under the number <span class="muted">(optional, e.g. what you sell)</span><input name="tagline" maxlength="70" value="${esc(p.tagline ?? "")}" placeholder="Flyers, banners and branded shirts"></label>
<div class="actions"><button class="ghost">Update posters</button></div></form>
<div class="cards" style="margin-top:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${preview("portrait")}${preview("landscape")}</div>
<p class="muted small">The code opens a chat with ${esc(showWaId(p.whatsappNumber))}. Print on A4 or bigger, and test it with your own phone before putting it up.</p>`,
    );
  });

  app.get("/posters/poster.png", async (c) => {
    const p = await posterInput(c);
    if (!p.whatsappNumber) return c.notFound();
    const png = await renderPoster({ ...p, whatsappNumber: p.whatsappNumber });
    return c.body(new Uint8Array(png) as unknown as ArrayBuffer, 200, { "Content-Type": "image/png", "Content-Disposition": `inline; filename="poster-${p.orientation}.png"` });
  });

  app.get("/posters/poster.pdf", async (c) => {
    const p = await posterInput(c);
    if (!p.whatsappNumber) return c.notFound();
    const pdf = await renderPosterPdf({ ...p, whatsappNumber: p.whatsappNumber });
    return c.body(pdf as unknown as ArrayBuffer, 200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="poster-${p.orientation}.pdf"` });
  });

  // ---- Export (owners only) ----
  app.use("/export/*", async (c, next) => (await ctx.ownerOnly(c)) ?? next());
  app.use("/export", async (c, next) => (await ctx.ownerOnly(c)) ?? next());

  app.get("/export", async (c) => {
    const biz = c.get("biz");
    const info = await biz.data.info();
    const at = ctx.now();
    const lagos = new Date(at.getTime() + 3_600_000).toISOString();
    const thisMonth = lagos.slice(0, 7);
    const firstOfMonth = `${thisMonth}-01`;
    const sheetUrl = info?.sheetKey ? `${ctx.deps.publicUrl}/home/sheet/${biz.id}/${info.sheetKey}.csv` : null;
    return ctx.render(
      c,
      "Export orders and sales",
      "/home/export",
      `<h2>Spreadsheet (CSV)</h2>
<p>Every quote and order between two dates: order number, status, dates, customer, items and total. Opens in Excel, Google Sheets or Numbers.</p>
<form method="get" action="/home/export/orders.csv" class="card"><div class="row">
<label>From<input type="date" name="from" value="${firstOfMonth}" required></label><label>To (including)<input type="date" name="to" value="${lagos.slice(0, 10)}" required></label></div>
<div class="actions"><button>Download CSV</button></div></form>
<h2>Google Sheets, always up to date</h2>
${
  sheetUrl
    ? `<p>Paste this into cell A1 of a Google Sheet. The sheet then fills itself with your last 12 months of orders and refreshes about every hour.</p>
<p class="card" style="word-break:break-all"><code>=IMPORTDATA("${esc(sheetUrl)}")</code></p>
<p class="muted small">Anyone with this link can see your orders, so only paste it into sheets you control. If it gets out, make a new link: the old one stops working.</p>
<form method="post" action="/home/export/new-sheet-link"><button class="ghost small">Make a new link</button></form>`
    : `<p class="muted">This needs migration 0049. Ask yarnOga support.</p>`
}
<h2>PDF sales report</h2>
<p>A printable report for one month: quotes, orders, money paid in and still owed, and every order.</p>
<form method="get" action="/home/export/report.pdf" class="card"><label>Month<input type="month" name="month" value="${thisMonth}" required></label>
<div class="actions"><button>Download PDF</button></div></form>`,
    );
  });

  app.get("/export/orders.csv", async (c) => {
    const from = lagosMidnight(c.req.query("from") ?? "");
    const toDay = lagosMidnight(c.req.query("to") ?? "");
    if (!from || !toDay || toDay < from) return c.redirect("/home/export?msg=bad", 303);
    const to = new Date(toDay.getTime() + 86_400_000);
    const rows = await c.get("biz").data.exportRows(from, to);
    const name = `orders-${c.req.query("from")}-to-${c.req.query("to")}.csv`;
    return c.body(ordersCsv(rows, c.get("biz").currency), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` });
  });

  app.get("/export/report.pdf", async (c) => {
    const month = c.req.query("month") ?? "";
    const range = lagosMonth(month);
    if (!range) return c.redirect("/home/export?msg=bad", 303);
    const biz = c.get("biz");
    const rows = await biz.data.exportRows(range[0], range[1]);
    const label = new Date(range[0].getTime() + 3_600_000).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const pdf = salesReportPdf({ businessName: biz.name, period: label, rows, generatedAt: ctx.now(), currency: biz.currency });
    return c.body(pdf as unknown as ArrayBuffer, 200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="sales-${month}.pdf"` });
  });

  app.post("/export/new-sheet-link", async (c) => {
    await c.get("biz").data.newSheetKey();
    return c.redirect("/home/export?msg=new_link", 303);
  });
}

function today(d: Date): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
}
