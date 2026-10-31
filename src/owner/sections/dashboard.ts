import type { Hono } from "hono";
import { formatMoney } from "../../core/money.js";
import { lagosMonthKey } from "../../products/quote/credits.js";
import { lagosMonthStart } from "../../products/quote/plan.js";
import { columnOf, type BoardOrder, type SalesFigures } from "../../products/quote/board.js";
import type { CounterSale, ProductRecord, SoldLine } from "../store.js";
import type { AiPack } from "../../products/quote/topups.js";
import type { SectionContext } from "../index.js";
import { esc, icon, meter, stat } from "../layout.js";
import { profitByProduct, profitSummary, signedMoney } from "./counter.js";
import type { Env } from "../types.js";

const DAY = 86_400_000;
const LOW_STOCK = 5;

/** YYYY-MM-DD in Lagos. */
function lagosDay(d: Date): string {
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
}

export function registerDashboard(app: Hono<Env>, ctx: SectionContext) {
  app.get("/", async (c) => {
    const biz = c.get("biz");
    const money = (minor: number) => formatMoney(minor, biz.currency);
    const at = ctx.now();
    const thisMonth = lagosMonthStart(at);
    const lastMonth = lagosMonthStart(new Date(thisMonth.getTime() - 1));
    const since14 = new Date(at.getTime() - 13 * DAY);
    // Each part on its own, so one slow or missing table doesn't blank the page.
    const safe = <T>(p: Promise<T>, fallback: NoInfer<T>): Promise<T> =>
      p.catch((err) => {
        ctx.log.warn(`Owner app dashboard: ${String(err)}`);
        return fallback;
      });
    // Cashiers and riders see the orders, not the takings.
    const seesMoney = ctx.can(c, "money");
    const counter = biz.counter && seesMoney ? biz.counter : null;
    const month = lagosMonthKey(at);
    const [now, before, ai, aiLimit, chats, confirmed, top, products, open, botMessages, rated, counterSales, paidOrders, plan, aiExtra, packs] = await Promise.all([
      safe<SalesFigures>(biz.board.sales(thisMonth, at), { quotes: 0, orders: 0, paidInKobo: 0 }),
      safe<SalesFigures>(biz.board.sales(lastMonth, thisMonth), { quotes: 0, orders: 0, paidInKobo: 0 }),
      safe<number | null>(biz.board.aiRepliesUsed(month), null),
      safe<number | null>(biz.features ? biz.features.limit("ai_credits") : Promise.resolve(null), null),
      safe<{ customers: number; inbound: number; outbound: number }>(biz.data.chatCounts(thisMonth), { customers: 0, inbound: 0, outbound: 0 }),
      safe<Date[]>(biz.data.confirmedSince(since14), []),
      safe<Array<{ name: string; quantity: number; totalKobo: number }>>(biz.data.topItems(thisMonth, 5), []),
      safe<ProductRecord[]>(biz.prices.products(), []),
      safe<BoardOrder[]>(biz.board.orders(new Date(at.getTime() - 60 * DAY)), []),
      safe<{ sent: number; limit: number | null } | null>(biz.botMessages ? biz.botMessages() : Promise.resolve(null), null),
      safe<{ count: number; average: number | null; bad: number } | null>(biz.data.ratings ? biz.data.ratings(new Date(at.getTime() - 30 * DAY)) : Promise.resolve(null), null),
      safe<CounterSale[] | null>(counter ? counter.sales(thisMonth, at) : Promise.resolve(null), null),
      safe<Array<{ discountKobo: number; lines: SoldLine[] }> | null>(counter ? counter.paidOrders(thisMonth, at) : Promise.resolve(null), null),
      safe<{ name: string; orderLimit: number | null } | null>(seesMoney && biz.plan ? biz.plan() : Promise.resolve(null), null),
      safe<number>(seesMoney && biz.topUps ? biz.topUps.extra(month) : Promise.resolve(0), 0),
      // Only the owner can buy replies.
      safe<AiPack[]>(c.get("user").role === "owner" && biz.topUps ? biz.topUps.packs() : Promise.resolve([]), []),
    ]);

    const n = (x: number) => x.toLocaleString("en-NG");

    // Orders a day, last 14 days: the busiest day in lime, today outlined.
    const days = Array.from({ length: 14 }, (_, i) => lagosDay(new Date(since14.getTime() + i * DAY)));
    const perDay = new Map(days.map((d) => [d, 0]));
    for (const t of confirmed) {
      const d = lagosDay(t);
      if (perDay.has(d)) perDay.set(d, perDay.get(d)! + 1);
    }
    const peak = Math.max(1, ...perDay.values());
    const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    const chart = days
      .map((d, i) => {
        const count = perDay.get(d)!;
        const top = count === peak && count > 0;
        const today = i === days.length - 1;
        return `<div class="col" title="${d}: ${count} orders"><div class="barw"><div class="bar${top ? " top" : ""}${today ? " today" : ""}" style="height:${Math.max(3, Math.round((count * 100) / peak))}%"><b>${count}</b></div></div><span class="day">${today ? "Today" : weekday(d)}</span></div>`;
      })
      .join("");
    const twoWeeks = confirmed.length;

    const waiting = open.filter((o) => columnOf(o) === "new");
    const toMake = open.filter((o) => ["paid", "in_production"].includes(columnOf(o)));
    const onRoad = open.filter((o) => columnOf(o) === "out_for_delivery");
    const low = products.flatMap((p) =>
      p.options.filter((o) => o.stock !== null && o.stock <= LOW_STOCK).map((o) => `${p.name}: ${o.name} (${o.stock} left)`),
    );
    const owed = waiting.reduce((s, o) => s + o.totalKobo, 0);

    const pct = (a: number, b: number) => (b ? ((a - b) * 100) / b : null);
    const conversion = now.quotes ? Math.round((now.orders * 100) / now.quotes) : 0;
    const bestTotal = Math.max(1, ...top.map((t) => t.totalKobo));
    const user = c.get("user");
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Lagos" }).format(at));
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const dateText = at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });

    // Owners see a reminder until their business is verified.
    const kyb = user.role === "owner" && ctx.deps.verification ? await ctx.deps.verification.store.get(biz.id).catch(() => null) : null;
    const verifyBanner =
      kyb && kyb.status !== "approved" && kyb.status !== "submitted"
        ? `<div class="card banner${kyb.status === "not_started" ? " glow" : ""}"><div><h3 style="margin:0 0 4px">${kyb.status === "not_started" ? "Verify your business" : "Your verification needs attention"}</h3><p class="muted small" style="margin:0">${kyb.status === "not_started" ? "A few details and documents so customers and yarnOga know who they're dealing with. About 5 minutes." : "yarnOga needs a little more from you before your business is verified."}</p></div><a class="button" href="/home/verify">${icon("shield", 18)}${kyb.status === "not_started" ? "Start" : "Open"}</a></div>`
        : "";

    // Profit: counter sales and paid WhatsApp orders, from the cost prices they had when sold.
    const keptSales = (counterSales ?? []).filter((s) => !s.voided);
    const profit = counterSales && paidOrders ? profitSummary([...keptSales, ...paidOrders]) : null;
    const byProduct = profit ? profitByProduct([...keptSales, ...paidOrders!].flatMap((s) => s.lines), 5) : [];
    const bestProfit = Math.max(1, ...byProduct.map((t) => t.profitKobo));
    const profitCard = profit
      ? `<section class="card" style="margin-top:14px">
    <div class="cardhead"><div><h3>Profit by product this month</h3><p class="muted small" style="margin:0">Counter sales and paid WhatsApp orders, before discounts</p></div><a href="/home/counter">Counter sale ${icon("arrow", 16)}</a></div>
    ${
      byProduct.length
        ? `<ul class="rank">${byProduct
            .map(
              (t) => `<li><div class="rankrow"><b>${esc(t.name)}</b><span>${signedMoney(t.profitKobo, biz.currency)}</span></div><div class="meter"><span style="width:${Math.max(0, Math.round((t.profitKobo * 100) / bestProfit))}%"></span></div><p class="muted small" style="margin:4px 0 0">${n(t.quantity)} sold for ${money(t.salesKobo)}${t.salesKobo ? ` · ${Math.round((t.profitKobo * 100) / t.salesKobo)}% margin` : ""}</p></li>`,
            )
            .join("")}</ul>`
        : `<p class="muted">No sales with a cost price yet this month. Add what each item costs you on the <a href="/home/prices">price list</a> and profit shows here.</p>`
    }
  </section>`
      : "";

    const body = `${verifyBanner}
<section class="hero">
  <div><h2>${greeting}${user.name ? `, ${esc(user.name)}` : ""} 👋</h2><p>${esc(dateText)} · your bot has talked to ${n(chats.customers)} customers this month.</p></div>
  <div class="quick">${biz.counter && ctx.can(c, "counter") ? `<a class="button" href="/home/counter">${icon("till", 18)}Counter sale</a>` : ""}${ctx.can(c, "edit_prices") ? `<a class="button" href="/home/prices/new">${icon("plus", 18)}Add product</a>` : ""}${ctx.can(c, "tools") ? `<a class="button ghost" href="/home/test">${icon("test", 18)}Test bot</a><a class="button ghost" href="/home/posters">${icon("posters", 18)}QR poster</a>` : `<a class="button" href="/home/orders">${icon("orders", 18)}Orders</a>`}</div>
</section>

<div class="grid">
${seesMoney ? stat("Paid in this month", money(now.paidInKobo), `vs ${money(before.paidInKobo)} last month`, { change: pct(now.paidInKobo, before.paidInKobo), glow: true, icon: "prices" }) : ""}
${stat("Orders this month", n(now.orders), `vs ${n(before.orders)} last month`, { change: pct(now.orders, before.orders), glow: !seesMoney, icon: "orders" })}
${stat("Quotes sent", n(now.quotes), `${conversion}% became orders`, { icon: "export" })}
${stat("Customers who messaged", n(chats.customers), `${n(chats.inbound)} in · ${n(chats.outbound)} out`, { icon: "inbox" })}
${profit ? stat("Profit this month", signedMoney(profit.profitKobo, biz.currency), profit.missing ? `${n(profit.counted)} sales · ${n(profit.missing)} left out (no cost price)` : `from ${n(profit.counted)} sales`, { icon: "prices" }) : ""}
${counterSales ? stat("Counter sales this month", money(keptSales.reduce((t, s) => t + s.totalKobo, 0)), `${n(keptSales.length)} sale${keptSales.length === 1 ? "" : "s"} · not in Paid in`, { icon: "till" }) : ""}
${rated && rated.count ? stat("Customer rating", `${rated.average!.toFixed(1)} / 5`, `${n(rated.count)} rating${rated.count === 1 ? "" : "s"} in 30 days${rated.bad ? ` · ${n(rated.bad)} not good` : ""}`, { icon: "star" }) : ""}
</div>

<div class="split" style="margin-top:14px">
  <section class="card">
    <div class="cardhead"><div><h3>Orders</h3><p class="muted small" style="margin:0">Last 14 days · ${n(twoWeeks)} orders</p></div><a href="/home/orders">Order board ${icon("arrow", 16)}</a></div>
    <div class="chart" role="img" aria-label="Orders per day for the last 14 days">${chart}</div>
  </section>
  ${seesMoney ? usageCard({ plan, orders: now.orders, ai: ai ?? 0, aiLimit, aiExtra, botMessages, packs, money }) : ""}
</div>

<div class="split even" style="margin-top:14px">
  <section class="card">
    <div class="cardhead"><h3>Needs you</h3><a href="/home/orders">Open orders ${icon("arrow", 16)}</a></div>
    <div class="tiles">
      <a class="tile" href="/home/orders"><span><i class="dot amber"></i>Waiting for payment</span><b>${waiting.length}</b><span>${!owed ? "All paid up" : seesMoney ? `${money(owed)} owed` : "to collect"}</span></a>
      <a class="tile" href="/home/orders"><span><i class="dot lime"></i>To make</span><b>${toMake.length}</b><span>paid or in production</span></a>
      <a class="tile" href="/home/delivery"><span><i class="dot blue"></i>On the road</span><b>${onRoad.length}</b><span>out for delivery</span></a>
      <a class="tile" href="${ctx.can(c, "see_prices") ? "/home/prices" : "/home"}"><span><i class="dot red"></i>Running low</span><b>${low.length}</b><span>${low.length ? esc(low[0]!) : "Stock looks fine"}</span></a>
    </div>
  </section>
  <section class="card">
    <div class="cardhead"><h3>Best sellers this month</h3>${ctx.can(c, "see_prices") ? `<a href="/home/prices">Price list ${icon("arrow", 16)}</a>` : ""}</div>
    ${
      top.length
        ? `<ul class="rank">${top
            .map(
              (t) => `<li><div class="rankrow"><b>${esc(t.name)}</b><span>${seesMoney ? money(t.totalKobo) : `${n(t.quantity)} pieces`}</span></div><div class="meter"><span style="width:${Math.round((t.totalKobo * 100) / bestTotal)}%"></span></div>${seesMoney ? `<p class="muted small" style="margin:4px 0 0">${n(t.quantity)} pieces</p>` : ""}</li>`,
            )
            .join("")}</ul>`
        : `<p class="muted">No orders yet this month.${ctx.can(c, "tools") ? ` Share your QR poster to get customers chatting: <a href="/home/posters">make one</a>.` : ""}</p>`
    }
  </section>
</div>

${profitCard}

<p class="muted small" style="margin-top:14px">${seesMoney ? `"Paid in" counts orders marked paid, including delivery fees. ` : ""}Numbers include any branches.</p>`;
    return ctx.render(c, "Dashboard", "/home", body);
  });

  // A pack of AI replies: off to Paystack, and the replies are added once it's paid.
  app.post("/topup", async (c) => {
    const denied = ctx.ownerOnly(c);
    if (denied) return denied;
    const biz = c.get("biz");
    if (!biz.topUps) return c.redirect("/home", 303);
    const pack = String((await c.req.parseBody()).pack ?? "");
    try {
      const made = await biz.topUps.link(pack, c.get("user").waId);
      if (made) return c.redirect(made.url, 303);
    } catch (err) {
      ctx.log.error("Owner app: couldn't make an AI top-up link:", err);
    }
    return c.redirect("/home?msg=topup_failed", 303);
  });

  app.get("/status", async (c) => {
    if (!ctx.deps.health) return ctx.render(c, "Status", "/home/status", `<p>Status checks aren't switched on.</p>`);
    const r = await ctx.deps.health();
    const labels = ctx.deps.healthLabels ?? {};
    const rows = Object.entries(r.checks)
      .map(
        ([name, x]) =>
          `<tr><td>${esc(labels[name] ?? name)}</td><td>${x.ok ? '<span class="tag lime">Working</span>' : '<span class="tag red">Not working</span>'}</td><td class="muted small">${esc(x.note ?? `${x.ms} ms`)}</td></tr>`,
      )
      .join("");
    return ctx.render(
      c,
      "Status",
      "/home/status",
      `<p class="flash ${r.ok ? "good" : "bad"}">${r.ok ? "Everything is working." : "Something isn't working. yarnOga has been alerted and is on it."}</p>
<div class="scroll"><table><tr><th>Part</th><th>State</th><th>Detail</th></tr>${rows}</table></div>
<p class="muted small">Checked ${esc(r.checkedAt.replace("T", " ").slice(0, 16))} UTC. These are checked every 5 minutes; yarnOga gets an alert by WhatsApp and email if one stops working.</p>`,
    );
  });

  app.get("/help", (c) => {
    const s = ctx.deps.support;
    const wa = s.waNumber ? `<a class="button" href="https://wa.me/${esc(s.waNumber)}?text=${encodeURIComponent("Hi yarnOga, I need help with my app")}">Chat with support on WhatsApp</a>` : "";
    const commands: Array<[string, string]> = [
      ["app", "a one-time link to open this app"],
      ["paid KP-1001", "mark an order paid and send the receipt (use your own order letters)"],
      ["invoice KP-1001 / receipt KP-1001", "get a copy to forward or print"],
      ["orders", "a link to your order board"],
      ["stock", "see and change stock levels"],
      ["a photo with the caption logo", "set the logo on invoices and receipts"],
      ["plan", "your plan and how to upgrade"],
    ];
    const faq: Array<[string, string]> = [
      ["Does the AI make up prices?", "Never. The AI only works out what the customer wants. Every price and total comes from your price list, worked out by the app."],
      ["A customer wants to talk to a person", "Open the chat in the Inbox and press Take over. The bot stays quiet in that chat until you press Hand back. Replying from the WhatsApp Business app also pauses the bot for an hour."],
      ["How do customers pay?", "By transfer to the bank account printed on their invoice (Settings > Bank accounts), or by card through a pay link if online payments are on for your business. Mark transfers paid in Orders."],
      ["Why didn't a customer get my reply?", "WhatsApp only delivers ordinary messages within 24 hours of the customer's last message. After that, wait for them to write again."],
      ["Who can see my app?", "Only you and the people you add under Settings > Team. Each gets a role: a manager sees everything except Settings, Export and Verify business; a cashier sees chats, orders and customers but not takings or totals; a rider sees only orders and deliveries."],
      ["How do I change prices?", "Price list > open the product > change the price > Save. Customers get the new price straight away."],
    ];
    return ctx.render(
      c,
      "Help and how it works",
      "/home/help",
      `<h2>How it works</h2>
<ol class="steps">
<li><b>Customers message your WhatsApp number</b>, typed or as a voice note: "500 A5 flyers, both sides".</li>
<li><b>The AI understands what they want</b> and matches it to your price list. It never sees or sets prices.</li>
<li><b>They get an itemised quote</b> priced from your list, with an order number like ${esc(c.get("biz").orderPrefix)}-1001.</li>
<li><b>They reply YES</b>: it becomes an order, they get an invoice with your bank details, and you get an alert.</li>
<li><b>When they pay</b>, mark it paid (here in Orders, or send <code>paid ${esc(c.get("biz").orderPrefix)}-1001</code>): they get a receipt.</li>
<li><b>Make and deliver</b>: move it along the order board, or send a rider (Riders & delivery).</li>
</ol>
<h2>Getting started checklist</h2>
<ol>
<li><a href="/home/prices">Add your price list</a>, with photos and minimum quantities.</li>
<li><a href="/home/settings">Add your bank account and alert numbers</a>.</li>
<li><a href="/home/test">Test your bot</a> with the questions customers ask.</li>
<li><a href="/home/posters">Print your QR poster</a> for the shop.</li>
</ol>
<h2>Commands you can send the bot on WhatsApp</h2>
<div class="scroll"><table>${commands.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join("")}</table></div>
<h2>Questions</h2>
${faq.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
<h2>Get support</h2>
<p>We usually reply within a few hours, 8am to 8pm.</p>
<div class="actions">${wa}<a class="button ghost" href="mailto:${esc(s.email)}">Email ${esc(s.email)}</a><a class="button ghost" href="/home/status">Is everything working?</a></div>`,
    );
  });
}

/** Owners hear about a limit once this share of it is used. */
const NEAR = 0.8;

type Usage = { label: string; used: number; limit: number | null; note?: string };

/**
 * Orders, AI replies and bot messages this month against the plan's limits,
 * with a nudge to top up or upgrade once one is nearly used.
 */
export function usageCard(u: {
  plan: { name: string; orderLimit: number | null } | null;
  orders: number;
  ai: number;
  aiLimit: number | null;
  aiExtra: number;
  botMessages: { sent: number; limit: number | null } | null;
  packs: AiPack[];
  money: (minor: number) => string;
}): string {
  const n = (x: number) => x.toLocaleString("en-NG");
  const aiAllowed = u.aiLimit == null ? null : u.aiLimit + u.aiExtra;
  const orders: Usage = { label: "Orders", used: u.orders, limit: u.plan?.orderLimit ?? null };
  const ai: Usage = {
    label: "AI replies",
    used: aiAllowed == null ? u.ai : Math.min(u.ai, aiAllowed),
    limit: aiAllowed,
    note: u.aiExtra && u.aiLimit != null ? `${n(u.aiLimit)} on your plan + ${n(u.aiExtra)} topped up` : undefined,
  };
  const messages: Usage | null = u.botMessages && { label: "Bot messages", used: u.botMessages.sent, limit: u.botMessages.limit };
  const rows = [orders, ai, ...(messages ? [messages] : [])];
  const near = (r: Usage) => r.limit != null && r.used >= Math.ceil(r.limit * NEAR);

  const row = (r: Usage) =>
    `<li><div class="rankrow"><b>${r.label}</b><span>${n(r.used)}${r.limit != null ? ` of ${n(r.limit)}` : ""}</span></div>${
      r.limit != null ? meter(r.used, r.limit) : ""
    }<p class="muted small" style="margin:4px 0 0">${r.note ? esc(r.note) : r.limit == null ? "No limit on your plan" : `${n(Math.max(0, r.limit - r.used))} left`}</p></li>`;

  const nudges: string[] = [];
  if (near(ai)) {
    nudges.push(
      ai.used >= ai.limit!
        ? "Your AI replies for this month are used up. Your bot is answering with a simple numbered menu until the 1st."
        : `You've used ${Math.round((ai.used * 100) / ai.limit!)}% of this month's AI replies. After that your bot answers with a simple numbered menu until the 1st.`,
    );
  }
  if (near(orders)) {
    nudges.push(
      orders.used >= orders.limit!
        ? `You've taken all ${n(orders.limit!)} orders on your plan this month. New orders come to you to confirm by hand until the 1st.`
        : `You've taken ${n(orders.used)} of the ${n(orders.limit!)} orders on your plan this month.`,
    );
  }
  if (messages && near(messages)) nudges.push(`Your number has sent ${n(messages.used)} of the ${n(messages.limit!)} bot messages on your plan this month.`);

  const buy =
    near(ai) && u.packs.length
      ? `<div class="actions">${u.packs
          .map((p) => `<form method="post" action="/home/topup"><input type="hidden" name="pack" value="${esc(p.code)}"><button>Buy ${n(p.replies)} replies · ${esc(u.money(p.priceKobo))}</button></form>`)
          .join("")}</div>`
      : "";
  const nudge = nudges.length
    ? `<div class="flash bad" style="margin:14px 0 0">${nudges.map((t) => `<p style="margin:0 0 6px">${esc(t)}</p>`).join("")}<p style="margin:0">${
        buy ? "Buy more AI replies for this month, or send <b>plan</b> to your bot to move up a plan." : "Send <b>plan</b> to your bot to see the plans and upgrade."
      }</p>${buy}</div>`
    : "";

  return `<section class="card">
    <div class="cardhead"><h3>Plan usage this month</h3>${u.plan ? `<span class="tag lime">${esc(u.plan.name)}</span>` : ""}</div>
    <ul class="rank">${rows.map(row).join("")}</ul>${nudge}
    <p class="muted small" style="margin:14px 0 0">Each customer message the AI reads counts as one AI reply. Limits start again on the 1st.</p>
  </section>`;
}
