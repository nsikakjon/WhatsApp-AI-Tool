import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { formatNaira } from "../../core/money.js";
import { lagosMonthKey } from "./credits.js";
import type { PlanFeatures } from "./features.js";
import { lagosMonthStart } from "./plan.js";
import { showWaId } from "../../core/whatsapp/ids.js";

// The owner's orders page, behind a private signed link the owner gets by
// sending "orders" to the bot (QUOTE_ORDER_BOARD, migration 0036). Two parts,
// each on the plans that include it:
//   Sales (sales_dashboard): quotes, orders, quote-to-order rate, money paid
//     in and AI replies, this month against last month.
//   Order board (order_board): every confirmed order in one of five columns,
//     New > Paid > In production > Out for delivery > Delivered.
// New and Paid follow the order's status and Out for delivery its rider. The
// owner moves an order into production or marks it delivered here.

export type Column = "new" | "paid" | "in_production" | "out_for_delivery" | "delivered";
export type Stage = "in_production" | "delivered";

export interface BoardOrder {
  id: string;
  orderNumber: number;
  status: "confirmed" | "paid";
  stage: Stage | null;
  /** The delivery's status (migration 0030), or null with no delivery. */
  deliveryStatus: string | null;
  customerName: string | null;
  customerWaId: string;
  /** e.g. "100 x Flyers: A5, 20 x Mugs" */
  items: string;
  totalKobo: number;
  confirmedAt: Date;
  /** When it reached its column: delivered, moved, paid or confirmed. */
  movedAt: Date;
}

export interface SalesFigures {
  quotes: number;
  orders: number;
  paidInKobo: number;
}

export interface BoardStore {
  /** Orders confirmed (or paid) since this moment, newest first. Cancelled ones are left out. */
  orders(since: Date): Promise<BoardOrder[]>;
  /** Moves an order; false when it isn't this business's confirmed or paid order. */
  setStage(orderId: string, stage: Stage): Promise<boolean>;
  sales(from: Date, to: Date): Promise<SalesFigures>;
  /** AI replies counted this month (first day, YYYY-MM-DD); null when none were counted. */
  aiRepliesUsed(month: string): Promise<number | null>;
}

export interface BoardBusiness {
  name: string;
  orderPrefix: string;
  store: BoardStore;
  /** What the plan includes. Without it, both parts are shown. */
  features?: PlanFeatures;
}

export interface BoardDeps {
  /** Signs the links, so nobody can guess another business's page. */
  secret: string;
  business(id: string): Promise<BoardBusiness | null>;
  now?: () => Date;
}

const ON_THE_ROAD = ["assigned", "picked_up"];
/** Delivered orders stay on the board this long. */
const DELIVERED_SHOWN_MS = 7 * 24 * 60 * 60_000;
/** Orders older than this drop off the board. */
const BOARD_DAYS = 60;

export function columnOf(o: Pick<BoardOrder, "status" | "stage" | "deliveryStatus">): Column {
  if (o.stage === "delivered" || o.deliveryStatus === "delivered") return "delivered";
  if (o.deliveryStatus && ON_THE_ROAD.includes(o.deliveryStatus)) return "out_for_delivery";
  if (o.stage === "in_production") return "in_production";
  return o.status === "paid" ? "paid" : "new";
}

function signature(secret: string, businessId: string): string {
  return createHmac("sha256", secret).update(`orders:${businessId}`).digest("base64url").slice(0, 24);
}

export function ordersLink(secret: string, publicUrl: string, businessId: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/orders/${businessId}.${signature(secret, businessId)}`;
}

function readToken(secret: string, token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(signature(secret, id));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function createOrderBoard(deps: BoardDeps) {
  const app = new Hono();
  const now = () => (deps.now ? deps.now() : new Date());

  async function load(token: string) {
    const id = readToken(deps.secret, token);
    const business = id ? await deps.business(id) : null;
    if (!business) return null;
    const f = business.features;
    const [board, sales] = f ? await Promise.all([f.has("order_board"), f.has("sales_dashboard")]) : [true, true];
    return { ...business, board, sales };
  }

  app.get("/orders/:token", async (c) => {
    const b = await load(c.req.param("token"));
    if (!b) return c.html(page("Page not found", `<p>This link isn't right. Send <b>orders</b> to your bot on WhatsApp for a new one.</p>`), 404);
    if (!b.board && !b.sales) {
      return c.html(page(b.name, `<p>The order board and sales dashboard come with Pro and above. Send <b>plan</b> to your bot on WhatsApp to upgrade.</p>`));
    }
    const at = now();
    const parts: string[] = [];
    if (b.sales) parts.push(await salesSection(b, at));
    if (b.board) parts.push(await boardSection(b, at, c.req.param("token")));
    return c.html(page(b.name, parts.join("")));
  });

  app.post("/orders/:token/move", async (c) => {
    const token = c.req.param("token");
    const b = await load(token);
    if (!b || !b.board) return c.text("Not found", 404);
    const form = await c.req.parseBody();
    const stage = form.stage === "in_production" || form.stage === "delivered" ? form.stage : null;
    const orderId = typeof form.order === "string" && /^[0-9a-f-]{36}$/.test(form.order) ? form.order : null;
    if (stage && orderId) await b.store.setStage(orderId, stage);
    return c.redirect(`/orders/${token}#board`, 303);
  });

  return app;
}

async function salesSection(b: BoardBusiness, at: Date): Promise<string> {
  const thisMonth = lagosMonthStart(at);
  const lastMonth = lagosMonthStart(new Date(thisMonth.getTime() - 1));
  const [now, before, ai, aiLimit] = await Promise.all([
    b.store.sales(thisMonth, at),
    b.store.sales(lastMonth, thisMonth),
    // Counted only on plans with an AI cap (migration 0026); a miss just shows "not counted".
    b.store.aiRepliesUsed(lagosMonthKey(at)).catch(() => null),
    b.features ? b.features.limit("ai_credits") : Promise.resolve(null),
  ]);
  const rate = (s: SalesFigures) => (s.quotes ? `${Math.round((s.orders * 100) / s.quotes)}%` : "–");
  const row = (label: string, a: string, z: string) => `<tr><th>${label}</th><td>${a}</td><td>${z}</td></tr>`;
  const n = (x: number) => x.toLocaleString("en-NG");
  const aiText = ai == null ? "not counted" : aiLimit == null ? n(ai) : `${n(ai)} of ${n(aiLimit)}`;
  return `<section><h2>Sales</h2><table class="sales">
<tr><th></th><th>This month</th><th>Last month</th></tr>
${row("Quotes sent", String(now.quotes), String(before.quotes))}
${row("Orders", String(now.orders), String(before.orders))}
${row("Quote to order", rate(now), rate(before))}
${row("Paid in", formatNaira(now.paidInKobo), formatNaira(before.paidInKobo))}
${row("AI replies", aiText, "")}
</table><p class="muted">Paid in counts orders marked paid, including delivery fees.</p></section>`;
}

const COLUMNS: Array<{ id: Column; title: string }> = [
  { id: "new", title: "New" },
  { id: "paid", title: "Paid" },
  { id: "in_production", title: "In production" },
  { id: "out_for_delivery", title: "Out for delivery" },
  { id: "delivered", title: "Delivered" },
];

async function boardSection(b: BoardBusiness, at: Date, token: string): Promise<string> {
  const orders = await b.store.orders(new Date(at.getTime() - BOARD_DAYS * 24 * 60 * 60_000));
  const byColumn = new Map<Column, BoardOrder[]>(COLUMNS.map((c) => [c.id, []]));
  for (const o of orders) {
    const column = columnOf(o);
    if (column === "delivered" && at.getTime() - o.movedAt.getTime() > DELIVERED_SHOWN_MS) continue;
    byColumn.get(column)!.push(o);
  }

  const move = (o: BoardOrder, stage: Stage, label: string) =>
    `<form method="post" action="/orders/${esc(token)}/move"><input type="hidden" name="order" value="${o.id}"><input type="hidden" name="stage" value="${stage}"><button>${label}</button></form>`;
  const card = (o: BoardOrder, column: Column) => {
    const ref = `${b.orderPrefix}-${o.orderNumber}`;
    const actions = [
      column === "new" || column === "paid" ? move(o, "in_production", "Start production") : "",
      column !== "delivered" && column !== "out_for_delivery" ? move(o, "delivered", "Delivered") : "",
    ].join("");
    const hint =
      column === "new" ? `<p class="muted">When they pay, send <b>paid ${ref}</b> on WhatsApp.</p>` : "";
    return `<li class="card"><p><b>${ref}</b> · ${formatNaira(o.totalKobo)}</p>
<p>${esc(o.customerName ?? showWaId(o.customerWaId))}</p><p class="muted">${esc(o.items)}</p>
<p class="muted">${ago(o.movedAt, at)}</p>${hint}${actions ? `<div class="actions">${actions}</div>` : ""}</li>`;
  };

  const columns = COLUMNS.map((c) => {
    const list = byColumn.get(c.id)!;
    return `<div class="column"><h3>${c.title} <span class="count">${list.length}</span></h3><ul>${list.map((o) => card(o, c.id)).join("") || `<li class="empty">Nothing here</li>`}</ul></div>`;
  }).join("");
  return `<section id="board"><h2>Order board</h2><div class="board">${columns}</div></section>`;
}

function ago(then: Date, at: Date): string {
  const minutes = Math.max(0, Math.round((at.getTime() - then.getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Orders</title>
<style>
body{margin:0;font:16px/1.45 system-ui,sans-serif;background:#0c0d0d;color:#f3f4ef}
main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.5rem;margin:.2em 0 .6em}h2{font-size:1.15rem;margin:1.6em 0 .6em}h3{font-size:1rem;margin:0 0 8px}
p{margin:0 0 4px}.muted{color:#9a9d97;font-size:.9rem}
table.sales{border-collapse:collapse;width:100%;max-width:560px}
.sales th,.sales td{text-align:left;padding:8px 6px;border-bottom:1px solid #2e302f;font-weight:400}.sales th:first-child{color:#9a9d97}
.board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
@media (max-width:900px){.board{grid-template-columns:1fr}}
.column{background:#151616;border:1px solid #2e302f;border-radius:10px;padding:12px}
.count{color:#9a9d97;font-weight:400}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.card{background:#1d1e1e;border-radius:8px;padding:10px}.empty{color:#9a9d97;font-size:.9rem}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}form{margin:0}
button{background:#c6ff1f;color:#0c0d0d;border:0;border-radius:6px;padding:6px 10px;font:inherit;font-size:.85rem;font-weight:700;cursor:pointer}
</style></head><body><main><h1>${esc(title)}</h1>
${body}</main></body></html>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

type OrderRow = {
  id: string;
  order_number: number | string;
  status: "confirmed" | "paid";
  stage: Stage | null;
  stage_at: string | null;
  total_kobo: number | string;
  confirmed_at: string;
  paid_at: string | null;
  contacts: { wa_id: string; name: string | null };
  quote_order_items: Array<{ name: string; quantity: number }>;
  quote_deliveries?: { status: string; delivered_at: string | null } | Array<{ status: string; delivered_at: string | null }> | null;
};

/**
 * The board for one business and its branches, read from Supabase. With
 * delivery off, deliveries aren't read (migration 0030 may not be run).
 */
export function createSupabaseBoardStore(db: SupabaseClient, businessIds: string[], opts: { withDelivery: boolean }): BoardStore {
  return {
    async orders(since) {
      const delivery = opts.withDelivery ? ", quote_deliveries(status, delivered_at)" : "";
      const { data, error } = await db
        .from("quote_orders")
        .select(`id, order_number, status, stage, stage_at, total_kobo, confirmed_at, paid_at, contacts(wa_id, name), quote_order_items(name, quantity)${delivery}`)
        .in("business_id", businessIds)
        .in("status", ["confirmed", "paid"])
        .gte("confirmed_at", since.toISOString())
        .order("confirmed_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(`board orders failed: ${error.message}`);
      return ((data ?? []) as unknown as OrderRow[]).map((r) => {
        const d = Array.isArray(r.quote_deliveries) ? (r.quote_deliveries[0] ?? null) : (r.quote_deliveries ?? null);
        const moments = [r.confirmed_at, r.paid_at, r.stage_at, d?.delivered_at].filter((t): t is string => Boolean(t));
        return {
          id: r.id,
          orderNumber: Number(r.order_number),
          status: r.status,
          stage: r.stage,
          deliveryStatus: d?.status ?? null,
          customerName: r.contacts.name,
          customerWaId: r.contacts.wa_id,
          items: r.quote_order_items.map((i) => `${i.quantity} x ${i.name}`).join(", "),
          totalKobo: Number(r.total_kobo),
          confirmedAt: new Date(r.confirmed_at),
          movedAt: new Date(moments.sort().at(-1)!),
        };
      });
    },

    async setStage(orderId, stage) {
      const at = new Date().toISOString();
      const { data, error } = await db
        .from("quote_orders")
        .update({ stage, stage_at: at, updated_at: at })
        .eq("id", orderId)
        .in("business_id", businessIds)
        .in("status", ["confirmed", "paid"])
        .select("id");
      if (error) throw new Error(`setStage failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async sales(from, to) {
      const range = <Q extends { gte(c: string, v: string): Q; lt(c: string, v: string): Q }>(q: Q, column: string) =>
        q.gte(column, from.toISOString()).lt(column, to.toISOString());
      const count = async (column: string) => {
        const { count, error } = await range(
          db.from("quote_orders").select("id", { count: "exact", head: true }).in("business_id", businessIds),
          column,
        );
        if (error) throw new Error(`sales count failed: ${error.message}`);
        return count ?? 0;
      };
      const [quotes, orders, paid] = await Promise.all([
        count("created_at"),
        count("confirmed_at"),
        range(db.from("quote_orders").select("total_kobo").in("business_id", businessIds).eq("status", "paid"), "paid_at"),
      ]);
      if (paid.error) throw new Error(`sales paid failed: ${paid.error.message}`);
      return { quotes, orders, paidInKobo: (paid.data ?? []).reduce((sum, r) => sum + Number(r.total_kobo), 0) };
    },

    async aiRepliesUsed(month) {
      const { data, error } = await db.from("quote_ai_usage").select("credits_used").in("business_id", businessIds).eq("month", month);
      if (error) throw new Error(`aiRepliesUsed failed: ${error.message}`);
      return data && data.length ? data.reduce((sum, r) => sum + Number(r.credits_used), 0) : null;
    },
  };
}
