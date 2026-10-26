import type { Hono } from "hono";
import { formatNaira } from "../../core/money.js";
import { lagosMonthKey } from "../../products/quote/credits.js";
import { lagosMonthStart } from "../../products/quote/plan.js";
import { columnOf, type BoardOrder, type SalesFigures } from "../../products/quote/board.js";
import type { ProductRecord } from "../store.js";
import type { SectionContext } from "../index.js";
import { esc, meter, stat } from "../layout.js";
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
    const [now, before, ai, aiLimit, chats, confirmed, top, products, open, botMessages] = await Promise.all([
      safe<SalesFigures>(biz.board.sales(thisMonth, at), { quotes: 0, orders: 0, paidInKobo: 0 }),
      safe<SalesFigures>(biz.board.sales(lastMonth, thisMonth), { quotes: 0, orders: 0, paidInKobo: 0 }),
      safe<number | null>(biz.board.aiRepliesUsed(lagosMonthKey(at)), null),
      safe<number | null>(biz.features ? biz.features.limit("ai_credits") : Promise.resolve(null), null),
      safe<{ customers: number; inbound: number; outbound: number }>(biz.data.chatCounts(thisMonth), { customers: 0, inbound: 0, outbound: 0 }),
      safe<Date[]>(biz.data.confirmedSince(since14), []),
      safe<Array<{ name: string; quantity: number; totalKobo: number }>>(biz.data.topItems(thisMonth, 5), []),
      safe<ProductRecord[]>(biz.prices.products(), []),
      safe<BoardOrder[]>(biz.board.orders(new Date(at.getTime() - 60 * DAY)), []),
      safe<{ sent: number; limit: number | null } | null>(biz.botMessages ? biz.botMessages() : Promise.resolve(null), null),
    ]);

    const rate = (o: number, q: number) => (q ? `${Math.round((o * 100) / q)}%` : "–");
    const change = (a: number, b: number) => (b ? `${a >= b ? "▲" : "▼"} ${Math.abs(Math.round(((a - b) * 100) / b))}% on last month` : "");
    const n = (x: number) => x.toLocaleString("en-NG");

    // Orders a day, last 14 days.
    const days = Array.from({ length: 14 }, (_, i) => lagosDay(new Date(since14.getTime() + i * DAY)));
    const perDay = new Map(days.map((d) => [d, 0]));
    for (const t of confirmed) {
      const d = lagosDay(t);
      if (perDay.has(d)) perDay.set(d, perDay.get(d)! + 1);
    }
    const peak = Math.max(1, ...perDay.values());
    const bars = days
      .map((d) => `<span style="height:${Math.round((perDay.get(d)! * 100) / peak)}%" title="${d}: ${perDay.get(d)} orders"></span>`)
      .join("");

    const waiting = open.filter((o) => columnOf(o) === "new").length;
    const toMake = open.filter((o) => ["paid", "in_production"].includes(columnOf(o))).length;
    const low = products.flatMap((p) =>
      p.options.filter((o) => o.stock !== null && o.stock <= LOW_STOCK).map((o) => `${p.name}: ${o.name} (${o.stock} left)`),
    );

    const aiText = ai == null ? "not counted" : aiLimit == null ? n(ai) : `${n(ai)} of ${n(aiLimit)}`;
    const body = `
<div class="grid">
${stat("Paid in this month", formatNaira(now.paidInKobo), change(now.paidInKobo, before.paidInKobo))}
${stat("Orders this month", n(now.orders), change(now.orders, before.orders))}
${stat("Quotes sent", n(now.quotes), `${rate(now.orders, now.quotes)} became orders`)}
${stat("Customers who messaged", n(chats.customers), `${n(chats.inbound)} messages in, ${n(chats.outbound)} out`)}
</div>
<h2>Needs you</h2>
<div class="grid">
<a class="card" href="/app/orders" style="text-decoration:none;color:inherit"><p class="label muted small">WAITING FOR PAYMENT</p><p class="value" style="font-size:1.4rem;font-weight:800;margin:0">${waiting}</p></a>
<a class="card" href="/app/orders" style="text-decoration:none;color:inherit"><p class="label muted small">TO MAKE OR DELIVER</p><p class="value" style="font-size:1.4rem;font-weight:800;margin:0">${toMake}</p></a>
<a class="card" href="/app/prices" style="text-decoration:none;color:inherit"><p class="label muted small">RUNNING LOW</p><p class="value" style="font-size:1.4rem;font-weight:800;margin:0">${low.length}</p>${low.length ? `<p class="muted small">${esc(low.slice(0, 3).join(", "))}${low.length > 3 ? "…" : ""}</p>` : ""}</a>
</div>
<h2>Orders, last 14 days</h2>
<div class="card"><div class="bars" role="img" aria-label="Orders per day for the last 14 days">${bars}</div>
<p class="muted small" style="display:flex;justify-content:space-between;margin-top:6px"><span>${days[0]}</span><span>today</span></p></div>
<h2>AI replies and messages this month</h2>
<div class="grid">
<div class="stat"><p class="label">AI replies</p><p class="value">${esc(aiText)}</p>${ai != null ? meter(ai, aiLimit) : ""}<p class="muted small">Each customer message the AI reads counts as one.</p></div>
${botMessages ? `<div class="stat"><p class="label">Bot messages sent</p><p class="value">${n(botMessages.sent)}${botMessages.limit != null ? ` of ${n(botMessages.limit)}` : ""}</p>${meter(botMessages.sent, botMessages.limit)}</div>` : ""}
<div class="stat"><p class="label">Last month</p><p class="value">${formatNaira(before.paidInKobo)}</p><p class="muted small">${n(before.orders)} orders from ${n(before.quotes)} quotes</p></div>
</div>
<h2>Best sellers this month</h2>
${
  top.length
    ? `<div class="scroll"><table><tr><th>Item</th><th>Pieces</th><th>Sales</th></tr>${top
        .map((t) => `<tr><td>${esc(t.name)}</td><td>${n(t.quantity)}</td><td>${formatNaira(t.totalKobo)}</td></tr>`)
        .join("")}</table></div>`
    : `<p class="muted">No orders yet this month. Share your QR poster to get customers chatting: <a href="/app/posters">make one</a>.</p>`
}
<p class="muted small">"Paid in" counts orders marked paid, including delivery fees. Numbers include any branches.</p>`;
    return ctx.render(c, "Dashboard", "/app", body);
  });

  app.get("/status", async (c) => {
    if (!ctx.deps.health) return ctx.render(c, "Status", "/app/status", `<p>Status checks aren't switched on.</p>`);
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
      "/app/status",
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
      ["Who can see my app?", "Only people you add under Settings > Team, and you. Staff can't see bank accounts, exports or settings."],
      ["How do I change prices?", "Price list > open the product > change the price > Save. Customers get the new price straight away."],
    ];
    return ctx.render(
      c,
      "Help and how it works",
      "/app/help",
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
<li><a href="/app/prices">Add your price list</a>, with photos and minimum quantities.</li>
<li><a href="/app/settings">Add your bank account and alert numbers</a>.</li>
<li><a href="/app/test">Test your bot</a> with the questions customers ask.</li>
<li><a href="/app/posters">Print your QR poster</a> for the shop.</li>
</ol>
<h2>Commands you can send the bot on WhatsApp</h2>
<div class="scroll"><table>${commands.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join("")}</table></div>
<h2>Questions</h2>
${faq.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
<h2>Get support</h2>
<p>We usually reply within a few hours, 8am to 8pm.</p>
<div class="actions">${wa}<a class="button ghost" href="mailto:${esc(s.email)}">Email ${esc(s.email)}</a><a class="button ghost" href="/app/status">Is everything working?</a></div>`,
    );
  });
}
