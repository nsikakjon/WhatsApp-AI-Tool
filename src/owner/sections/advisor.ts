import type { Hono } from "hono";
import { isPhoneNumber } from "../../core/whatsapp/ids.js";
import { advisorTexts, ask, FRESH_HOURS, isQuestion, NAME_SLOT, QUESTIONS, winBackFor, type Answer } from "../advisor/index.js";
import type { SectionContext } from "../index.js";
import { esc } from "../layout.js";
import type { AppContext, Env } from "../types.js";

// The business advisor page (QUOTE_BUSINESS_ADVISOR, Pro and above, owners
// only): five questions about the shop, answered from its own figures. The
// figures come from code; the AI adds a few lines of advice (advisor/).

/** WhatsApp's *bold* as HTML, after escaping. */
const rich = (text: string) => esc(text).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

export function answerHtml(answer: Answer, lang: string, left: number | null): string {
  const t = advisorTexts(lang);
  const time = new Date(answer.at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  const facts = `<div class="card"><h3 style="margin-top:0">${esc(t.title[answer.question])}</h3><p>${answer.facts.map(rich).join("<br>")}</p>
<p class="muted small" style="margin:0">Worked out at ${time} from your own orders${answer.question === "prices" ? " and price list" : ""}. Asking again within ${FRESH_HOURS} hours shows this answer.</p></div>`;

  let more = "";
  if (answer.winBack) {
    const rows = answer.winBack.people
      .filter((p) => isPhoneNumber(p.waId))
      .map((p) => {
        const link = `https://wa.me/${p.waId}?text=${encodeURIComponent(winBackFor(answer.winBack!.draft, p.name, lang))}`;
        return `<tr><td>${esc(p.name ?? `+${p.waId}`)}</td><td><a class="button small" href="${esc(link)}" target="_blank" rel="noopener">Send on WhatsApp</a></td></tr>`;
      })
      .join("");
    more += `<div class="card"><h3 style="margin-top:0">A message to send them</h3><p>${rich(answer.winBack.draft.replace(NAME_SLOT, "[their name]"))}</p>
<p class="muted small">Each button opens WhatsApp on your phone with the message and the customer's first name filled in. You send it yourself, so check it first.</p>
<div class="scroll"><table>${rows}</table></div></div>`;
  }
  if (answer.advice && answer.question === "post") {
    more += `<div class="card"><h3 style="margin-top:0">Your post</h3><textarea readonly rows="10" onclick="this.select()" aria-label="Your post">${esc(answer.advice)}</textarea>
<div class="actions"><a class="button" href="https://wa.me/?text=${esc(encodeURIComponent(answer.advice))}" target="_blank" rel="noopener">Share on WhatsApp</a></div>
<p class="muted small">Check the prices before you post: they're your price list's lowest prices for one piece.</p></div>`;
  } else if (answer.advice) {
    more += `<div class="card"><h3 style="margin-top:0">💡 What to do</h3><p>${rich(answer.advice)}</p></div>`;
  }
  if (answer.limitReached) more += `<p class="flash bad">You've used this month's written answers, so this one has the figures only. More come next month, or upgrade your plan for more.</p>`;
  else if (left !== null) more += `<p class="muted small">Written answers left this month: ${left}.</p>`;
  return facts + more;
}

export function registerAdvisor(app: Hono<Env>, ctx: SectionContext) {
  app.use("/advisor", gate);
  app.use("/advisor/*", gate);
  async function gate(c: AppContext, next: () => Promise<void>) {
    const denied = ctx.ownerOnly(c);
    if (denied) return denied;
    if (!c.get("biz").advisor) return c.redirect("/home", 303);
    await next();
  }

  const menu = (c: AppContext) => {
    const t = advisorTexts(c.get("biz").language);
    return `<div class="grid">${QUESTIONS.map(
      (q) => `<form method="post" action="/home/advisor" class="card"><input type="hidden" name="q" value="${q}"><h3 style="margin-top:0">${esc(t.title[q])}</h3>
<p class="muted small">${esc(t.hint[q])}</p><button class="ghost small">Ask</button></form>`,
    ).join("")}</div>`;
  };

  app.get("/advisor", (c) =>
    ctx.render(
      c,
      "Business advisor",
      "/home/advisor",
      `<p class="muted">Questions about your shop, answered from your own sales. Every figure is worked out from your orders, counter sales and price list; the advice around them is written by AI, so read it as a suggestion. Only you see this page. You can also send <b>advice</b> to your bot on WhatsApp.</p>${menu(c)}`,
    ),
  );

  app.post("/advisor", async (c) => {
    const biz = c.get("biz");
    const q = (await c.req.parseBody()).q;
    if (!isQuestion(q)) return c.redirect("/home/advisor?msg=bad", 303);
    const { answer, left } = await ask(biz, biz.advisor!, q, ctx.now(), ctx.log);
    ctx.log.info(`Owner app: ${biz.name} asked the advisor "${q}"`);
    return ctx.render(c, "Business advisor", "/home/advisor", `<p><a href="/home/advisor">← All questions</a></p>${answerHtml(answer, biz.language, left)}<h2>Ask another</h2>${menu(c)}`);
  });
}
