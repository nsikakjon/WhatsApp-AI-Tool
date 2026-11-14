import type { Hono } from "hono";
import { formatNaira, parseMoney } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { addDays, lagosToday, showDay, type Member } from "../../products/quote/monthly.js";
import { normaliseWaId } from "../auth.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import type { AppContext, Env } from "../types.js";

// Monthly payments (QUOTE_MONTHLY_PAYMENTS): the business's monthly plans
// (gym membership, class fees) and the customers on them. Owners and
// managers only, as it shows takings.

const UUID = /^[0-9a-f-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The furthest ahead a first payment can be set. */
const MAX_START_DAYS = 60;
const MIN_PRICE_KOBO = 10_000;

function standing(m: Member, today: string): { label: string; tag: string } {
  if (m.status === "cancelled") return { label: "Cancelled", tag: "" };
  if (!m.open) return { label: m.lastPaidAt ? "Paid up" : "Starts soon", tag: m.lastPaidAt ? "lime" : "blue" };
  const late = Math.round((Date.parse(today) - Date.parse(m.open.period)) / 86_400_000);
  return late > 0 ? { label: `${late} day${late === 1 ? "" : "s"} late`, tag: late >= 7 ? "red" : "amber" } : { label: "Due today", tag: "amber" };
}

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

/** A message the owner can send from their own WhatsApp, with the link. */
function shareLink(m: Member, businessName: string, link: string): string {
  const text = `Hi ${m.name}, here's the link for your ${formatNaira(m.open!.amountKobo)} ${m.planName} payment at ${businessName}: ${link}`;
  return `https://wa.me/${m.waId}?text=${encodeURIComponent(text)}`;
}

export function registerMonthly(app: Hono<Env>, ctx: SectionContext) {
  app.use("/monthly", gate);
  app.use("/monthly/*", gate);
  async function gate(c: AppContext, next: () => Promise<void>) {
    const denied = ctx.need(c, "money");
    if (denied) return denied;
    if (!c.get("biz").monthly) return c.redirect("/home", 303);
    await next();
  }
  const service = (c: AppContext) => c.get("biz").monthly!;
  const back = (c: AppContext, text: string) =>
    ctx.render(c, "Monthly payments", "/home/monthly", `<p class="flash bad">${esc(text)}</p><p><a href="/home/monthly">Back</a></p>`, 400);

  app.get("/monthly", async (c) => {
    const { store } = service(c);
    const today = lagosToday(ctx.now());
    const [plans, members] = await Promise.all([store.plans(), store.members()]);
    const active = members.filter((m) => m.status === "active");
    const owed = active.reduce((sum, m) => sum + (m.open?.amountKobo ?? 0), 0);

    const planRows = plans
      .map((p) => {
        const count = active.filter((m) => m.planId === p.id).length;
        return `<tr><td><b>${esc(p.name)}</b>${p.active ? "" : ` <span class="tag">Not taking new customers</span>`}</td><td>${formatNaira(p.priceKobo)} a month</td><td>${count}</td>
<td><form method="post" action="/home/monthly/plan/${p.id}/${p.active ? "stop" : "start"}"><button class="ghost small">${p.active ? "Stop new sign-ups" : "Take new customers"}</button></form></td></tr>`;
      })
      .join("");

    const memberRows = members
      .map((m) => {
        const s = standing(m, today);
        return `<tr><td><a href="/home/monthly/m/${m.id}"><b>${esc(m.name)}</b></a><br><span class="muted small">${esc(showWaId(m.waId))}</span></td>
<td>${esc(m.planName)}</td><td>${m.status === "active" ? showDay(m.open?.period ?? m.nextDue) : "-"}</td><td>${m.card ? esc(m.card.label) : `<span class="muted">Link each month</span>`}</td>
<td><span class="tag ${s.tag}">${s.label}</span></td></tr>`;
      })
      .join("");

    const selling = plans.filter((p) => p.active);
    const addMember = selling.length
      ? `<form method="post" action="/home/monthly/member" class="card" style="max-width:34rem">
<h3 style="margin-top:0">Add a customer</h3>
<label>Name<input name="name" required maxlength="80" placeholder="Ada Okafor"></label>
<label>WhatsApp number<input name="wa" inputmode="tel" required placeholder="0803 123 4567"></label>
<label>Plan<select name="plan" required>${selling.map((p) => `<option value="${p.id}">${esc(p.name)}, ${formatNaira(p.priceKobo)}</option>`).join("")}</select></label>
<label>First payment<input name="start" type="date" required value="${today}" min="${today}" max="${addDays(today, MAX_START_DAYS)}"></label>
<p class="muted small">They pay on this day of the month from now on. If it's today, they get the first link straight away.</p>
<div class="actions"><button>Add customer</button></div></form>`
      : `<p class="muted">Add a plan first, then add customers to it.</p>`;

    return ctx.render(
      c,
      "Monthly payments",
      "/home/monthly",
      `<p class="muted">For customers who pay you every month: gym members, class fees, a regular supply. On their pay day the bot takes the payment from the card they used last time, or sends them a Paystack link. It reminds them after 3 and 7 days and tells you if they still haven't paid. The money goes to your bank account like your invoice pay links, less the same Paystack and yarnOga fees (see Settings).</p>
<div class="card"><div class="cardhead"><h3>Customers paying monthly</h3><b style="font-size:1.6rem">${active.length}</b></div>
<p class="muted small" style="margin:0">${owed ? `${formatNaira(owed)} due and not paid yet.` : "Nobody owes anything right now."}</p></div>
<h2>Your monthly plans</h2>
<div class="scroll"><table><tr><th>Plan</th><th>Price</th><th>Customers</th><th></th></tr>${planRows || `<tr><td colspan="4" class="muted">No plans yet.</td></tr>`}</table></div>
<form method="post" action="/home/monthly/plan" class="row" style="margin-top:12px"><label>New plan<input name="name" required maxlength="60" placeholder="Gym membership"></label>
<label>Price a month (₦)<input name="price" inputmode="decimal" required placeholder="15000"></label><button>Add plan</button></form>
<h2>Customers</h2>
<div class="scroll"><table><tr><th>Name</th><th>Plan</th><th>Next payment</th><th>Pays by</th><th></th></tr>${memberRows || `<tr><td colspan="5" class="muted">No customers yet.</td></tr>`}</table></div>
${addMember}`,
    );
  });

  app.post("/monthly/plan", async (c) => {
    const form = await c.req.parseBody();
    const name = field(form, "name", 60);
    const price = parseMoney(field(form, "price", 20));
    if (!name || price === null) return c.redirect("/home/monthly?msg=bad", 303);
    if (price < MIN_PRICE_KOBO) return back(c, `The lowest monthly price is ${formatNaira(MIN_PRICE_KOBO)}.`);
    await service(c).store.addPlan(name, price);
    return c.redirect("/home/monthly?msg=added", 303);
  });

  app.post("/monthly/plan/:id/:action{stop|start}", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.redirect("/home/monthly?msg=bad", 303);
    await service(c).store.setPlanActive(c.req.param("id"), c.req.param("action") === "start");
    return c.redirect("/home/monthly?msg=saved", 303);
  });

  app.post("/monthly/member", async (c) => {
    const { store, bill } = service(c);
    const form = await c.req.parseBody();
    const today = lagosToday(ctx.now());
    const name = field(form, "name", 80);
    const waId = normaliseWaId(field(form, "wa", 30));
    const start = field(form, "start", 10);
    const plan = (await store.plans()).find((p) => p.active && p.id === field(form, "plan", 40));
    if (!name || !plan) return c.redirect("/home/monthly?msg=bad", 303);
    if (!waId) return back(c, "That WhatsApp number doesn't look right. Use the full number, e.g. 0803 123 4567.");
    if (!DATE.test(start) || start < today || start > addDays(today, MAX_START_DAYS)) {
      return back(c, `Pick a first payment date from today to ${showDay(addDays(today, MAX_START_DAYS))}.`);
    }
    if ((await store.members()).some((m) => m.status === "active" && m.waId === waId && m.planId === plan.id)) {
      return back(c, `${showWaId(waId)} is already on ${plan.name}.`);
    }
    const id = await store.addMember({ planId: plan.id, name, waId, payDay: Number(start.slice(8, 10)), nextDue: start });
    ctx.log.info(`Owner app: ${c.get("biz").name} added a customer to ${plan.name}`);
    if (start === today) {
      await store.openDue(today);
      const m = await store.member(id);
      if (m?.open) {
        try {
          await bill(m, m.open);
        } catch (err) {
          ctx.log.error(`Owner app: first monthly link for ${c.get("biz").name} failed:`, err);
        }
      }
    }
    return c.redirect(`/home/monthly/m/${id}`, 303);
  });

  app.get("/monthly/m/:id", async (c) => {
    const m = UUID.test(c.req.param("id")) ? await service(c).store.member(c.req.param("id")) : null;
    if (!m) return c.redirect("/home/monthly", 303);
    const today = lagosToday(ctx.now());
    const s = standing(m, today);
    const open = m.open;
    const due = open
      ? `<div class="card"><h3 style="margin-top:0">${formatNaira(open.amountKobo)} due ${showDay(open.period)}</h3>
${
  open.linkUrl
    ? `<p class="muted small">${open.notices ? "We've sent them the link on WhatsApp." : "WhatsApp only lets your bot message someone who wrote to it in the last day, so send the link yourself the first time."}</p>
<p><input readonly value="${esc(open.linkUrl)}" aria-label="Payment link" onclick="this.select()"></p>
<div class="actions"><a class="button" href="${esc(shareLink(m, c.get("biz").name, open.linkUrl))}" target="_blank" rel="noopener">Send on WhatsApp</a></div>`
    : m.card && open.cardTriedAt
      ? `<p class="muted small">We've charged their ${esc(m.card.label)} and are waiting for Paystack to confirm.</p>`
      : `<p class="muted small">The link goes out in the next few minutes (8am to 8pm).</p>`
}</div>`
      : "";
    return ctx.render(
      c,
      m.name,
      "/home/monthly",
      `<p><a href="/home/monthly">← Monthly payments</a></p>
<div class="card" style="max-width:34rem"><table>
<tr><td class="muted">WhatsApp</td><td>${esc(showWaId(m.waId))}</td></tr>
<tr><td class="muted">Plan</td><td>${esc(m.planName)}</td></tr>
<tr><td class="muted">Status</td><td><span class="tag ${s.tag}">${s.label}</span></td></tr>
${m.status === "active" ? `<tr><td class="muted">Next payment</td><td>${showDay(open?.period ?? m.nextDue)}, then the ${m.payDay === 31 ? "last day" : ordinal(m.payDay)} of each month</td></tr>` : ""}
<tr><td class="muted">Pays by</td><td>${m.card ? `${esc(m.card.label)}, charged on the pay day` : "A link each month. Once they pay by card, that card is used from then on."}</td></tr>
</table></div>
${due}
${
  m.status === "active"
    ? `<div class="actions">${m.card ? `<form method="post" action="/home/monthly/m/${m.id}/forget-card"><button class="ghost small">Stop using their card</button></form>` : ""}
<form method="post" action="/home/monthly/m/${m.id}/cancel" onsubmit="return confirm('Cancel monthly payments for this customer? Nothing more will be charged.')"><button class="ghost small">Cancel monthly payments</button></form></div>`
    : ""
}`,
    );
  });

  app.post("/monthly/m/:id/cancel", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.redirect("/home/monthly?msg=bad", 303);
    await service(c).store.cancel(c.req.param("id"));
    return c.redirect(`/home/monthly/m/${c.req.param("id")}?msg=saved`, 303);
  });

  app.post("/monthly/m/:id/forget-card", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.redirect("/home/monthly?msg=bad", 303);
    await service(c).store.forgetCard(c.req.param("id"));
    return c.redirect(`/home/monthly/m/${c.req.param("id")}?msg=saved`, 303);
  });
}
