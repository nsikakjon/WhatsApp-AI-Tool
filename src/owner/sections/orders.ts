import type { Hono } from "hono";
import { formatMoney } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { columnOf, type BoardOrder, type Column, type Stage } from "../../products/quote/board.js";
import type { SectionContext } from "../index.js";
import { esc, initials } from "../layout.js";
import type { Env } from "../types.js";
import { when } from "./inbox.js";

// The order board: every confirmed order of the last 60 days in five columns,
// New > Paid > In production > Out for delivery > Delivered. From here the
// owner or staff mark an order paid (the customer gets their receipt), start
// production, or mark it delivered.

const COLUMNS: Array<{ id: Column; title: string; dot: string }> = [
  { id: "new", title: "Awaiting payment", dot: "amber" },
  { id: "paid", title: "Paid", dot: "lime" },
  { id: "in_production", title: "In production", dot: "blue" },
  { id: "out_for_delivery", title: "Out for delivery", dot: "blue" },
  { id: "delivered", title: "Delivered", dot: "" },
];
const DAY = 86_400_000;
const UUID = /^[0-9a-f-]{36}$/;

export function registerOrders(app: Hono<Env>, ctx: SectionContext) {
  app.get("/orders", async (c) => {
    const biz = c.get("biz");
    const money = (minor: number) => formatMoney(minor, biz.currency);
    if (biz.features && !(await biz.features.has("order_board"))) {
      return ctx.render(c, "Orders", "/home/orders", `<p>The order board comes with Pro and above. Send <b>plan</b> to your bot on WhatsApp to upgrade.</p>`);
    }
    const at = ctx.now();
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60);
    const orders = (await biz.board.orders(new Date(at.getTime() - 60 * DAY))).filter((o) => {
      if (!q) return true;
      const ref = `${biz.orderPrefix}-${o.orderNumber}`.toLowerCase();
      return ref.includes(q) || (o.customerName ?? "").toLowerCase().includes(q) || o.items.toLowerCase().includes(q);
    });
    const byColumn = new Map<Column, BoardOrder[]>(COLUMNS.map((x) => [x.id, []]));
    for (const o of orders) {
      const col = columnOf(o);
      if (col === "delivered" && at.getTime() - o.movedAt.getTime() > 7 * DAY) continue;
      byColumn.get(col)!.push(o);
    }
    const button = (o: BoardOrder, action: string, label: string, extra = "") =>
      `<form method="post" action="/home/orders/${action}"><input type="hidden" name="order" value="${o.id}"><input type="hidden" name="number" value="${o.orderNumber}">${extra}<button class="small${action === "paid" ? "" : " ghost"}">${label}</button></form>`;
    const who = (o: BoardOrder) => o.customerName ?? showWaId(o.customerWaId);
    const card = (o: BoardOrder, col: Column) => {
      const ref = `${biz.orderPrefix}-${o.orderNumber}`;
      const actions = [
        col === "new" && biz.markPaid ? button(o, "paid", "Mark paid") : "",
        col === "new" || col === "paid" ? button(o, "move", "Start production", `<input type="hidden" name="stage" value="in_production">`) : "",
        col !== "delivered" && col !== "out_for_delivery" ? button(o, "move", "Delivered", `<input type="hidden" name="stage" value="delivered">`) : "",
      ].join("");
      return `<li class="order"><div class="top"><b>${esc(ref)}</b><span class="tag">${esc(when(o.movedAt, at))}</span></div>
<p class="value" style="font-size:1.15rem;margin:2px 0">${money(o.totalKobo)}</p>
<p class="who"><span class="avatar">${esc(initials(who(o)))}</span>${esc(who(o))}</p><p class="muted small" style="margin:0">${esc(o.items)}</p>
${actions ? `<div class="actions">${actions}</div>` : ""}</li>`;
    };
    const columns = COLUMNS.map((x) => {
      const list = byColumn.get(x.id)!;
      const total = list.reduce((s, o) => s + o.totalKobo, 0);
      return `<section class="column"><h3><span><i class="dot ${x.dot}"></i>${x.title}</span><span class="count">${list.length}</span></h3><p class="muted small">${money(total)}</p><ul>${
        list.map((o) => card(o, x.id)).join("") || `<li class="muted small">Nothing here</li>`
      }</ul></section>`;
    }).join("");
    return ctx.render(
      c,
      "Orders",
      "/home/orders",
      `<form method="get" class="search"><input name="q" value="${esc(q)}" placeholder="Find an order, customer or item" aria-label="Search orders"><button class="ghost">Search</button></form>
<div class="board">${columns}</div>
<p class="muted small">Orders from the last 60 days. Delivered orders stay for 7 days. "Out for delivery" and "Delivered" also follow your riders when delivery is on. Need them all? <a href="/home/export">Export</a>.</p>`,
    );
  });

  app.post("/orders/move", async (c) => {
    const form = await c.req.parseBody();
    const stage: Stage | null = form.stage === "in_production" || form.stage === "delivered" ? form.stage : null;
    const order = typeof form.order === "string" && UUID.test(form.order) ? form.order : null;
    if (!stage || !order) return c.redirect("/home/orders?msg=bad", 303);
    await c.get("biz").board.setStage(order, stage);
    return c.redirect("/home/orders?msg=moved", 303);
  });

  app.post("/orders/paid", async (c) => {
    const biz = c.get("biz");
    const form = await c.req.parseBody();
    const number = Number(form.number);
    if (!biz.markPaid || !Number.isInteger(number) || number <= 0) return c.redirect("/home/orders?msg=bad", 303);
    const ok = await biz.markPaid(number);
    ctx.log.info(`Owner app: ${biz.orderPrefix}-${number} marked paid by ${c.get("user").role}`);
    return c.redirect(`/home/orders?msg=${ok ? "paid" : "not_paid"}`, 303);
  });
}
