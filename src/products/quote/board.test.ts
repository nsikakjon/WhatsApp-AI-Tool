import { describe, expect, it } from "vitest";
import { columnOf, createOrderBoard, ordersLink, type BoardOrder, type BoardStore, type Stage } from "./board.js";
import type { PlanFeature } from "./features.js";

const SECRET = "app-secret";
const BUSINESS = "00000000-0000-0000-0000-000000000002";
const NOW = new Date("2026-10-21T12:00:00Z");
const token = ordersLink(SECRET, "https://bot.example.com", BUSINESS).split("/orders/")[1]!;

function order(n: number, extra: Partial<BoardOrder> = {}): BoardOrder {
  return {
    id: `00000000-0000-0000-0000-00000000100${n}`,
    orderNumber: 1000 + n,
    status: "confirmed",
    stage: null,
    deliveryStatus: null,
    customerName: "Ada",
    customerWaId: "2348000000001",
    items: "100 x Flyers: A5",
    totalKobo: 1_500_000,
    confirmedAt: new Date("2026-10-21T09:00:00Z"),
    movedAt: new Date("2026-10-21T09:00:00Z"),
    ...extra,
  };
}

function setup(opts: { off?: PlanFeature[]; orders?: BoardOrder[] } = {}) {
  const moved: Array<[string, Stage]> = [];
  const salesAsked: Date[] = [];
  const store: BoardStore = {
    orders: async () => opts.orders ?? [],
    setStage: async (id, stage) => (moved.push([id, stage]), true),
    sales: async (from) => {
      salesAsked.push(from);
      return salesAsked.length === 1 ? { quotes: 40, orders: 10, paidInKobo: 12_000_000 } : { quotes: 0, orders: 0, paidInKobo: 0 };
    },
    aiRepliesUsed: async () => 812,
  };
  const app = createOrderBoard({
    secret: SECRET,
    now: () => NOW,
    business: async (id) =>
      id === BUSINESS
        ? {
            name: "Demo Shop",
            orderPrefix: "DEMO",
            store,
            features: { planCode: async () => "pro", has: async (f) => !(opts.off ?? []).includes(f), limit: async () => 7500 },
          }
        : null,
  });
  return { app, moved, salesAsked };
}

describe("board columns", () => {
  it("follows the order, the owner's moves and the rider", () => {
    expect(columnOf({ status: "confirmed", stage: null, deliveryStatus: null })).toBe("new");
    expect(columnOf({ status: "paid", stage: null, deliveryStatus: "proposed" })).toBe("paid");
    expect(columnOf({ status: "paid", stage: "in_production", deliveryStatus: null })).toBe("in_production");
    expect(columnOf({ status: "paid", stage: "in_production", deliveryStatus: "picked_up" })).toBe("out_for_delivery");
    expect(columnOf({ status: "paid", stage: null, deliveryStatus: "delivered" })).toBe("delivered");
    expect(columnOf({ status: "confirmed", stage: "delivered", deliveryStatus: null })).toBe("delivered");
  });
});

describe("orders page", () => {
  it("shows sales for this month and last, and the board", async () => {
    const { app, salesAsked } = setup({
      orders: [
        order(1),
        order(2, { status: "paid", stage: "in_production" }),
        order(3, { stage: "delivered", movedAt: new Date("2026-10-01T09:00:00Z") }),
      ],
    });
    const res = await app.request(`/orders/${token}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<th>Quotes sent</th><td>40</td><td>0</td>");
    expect(body).toContain("<th>Quote to order</th><td>25%</td><td>–</td>");
    expect(body).toContain("<th>Paid in</th><td>₦120,000</td>");
    expect(body).toContain("812 of 7,500");
    expect(salesAsked[0]?.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(body).toContain("DEMO-1001");
    expect(body).toContain("send <b>paid DEMO-1001</b>");
    expect(body).toContain("In production <span class=\"count\">1</span>");
    // Delivered three weeks ago: off the board.
    expect(body).not.toContain("DEMO-1003");
  });

  it("only shows the parts the plan includes", async () => {
    const noSales = await (await setup({ off: ["sales_dashboard"] }).app.request(`/orders/${token}`)).text();
    expect(noSales).not.toContain("Quotes sent");
    expect(noSales).toContain("Order board");
    const neither = await (await setup({ off: ["sales_dashboard", "order_board"] }).app.request(`/orders/${token}`)).text();
    expect(neither).toContain("come with Pro and above");
  });

  it("moves an order and refuses a link that isn't signed", async () => {
    const { app, moved } = setup({ orders: [order(1)] });
    const form = new URLSearchParams({ order: order(1).id, stage: "in_production" });
    const res = await app.request(`/orders/${token}/move`, { method: "POST", body: form });
    expect(res.status).toBe(303);
    expect(moved).toEqual([[order(1).id, "in_production"]]);

    const forged = `${BUSINESS}.${"x".repeat(24)}`;
    expect((await app.request(`/orders/${forged}`)).status).toBe(404);
    expect((await app.request(`/orders/${forged}/move`, { method: "POST", body: form })).status).toBe(404);
    expect(moved).toHaveLength(1);
  });

  it("won't let a plan without the board move orders", async () => {
    const { app, moved } = setup({ off: ["order_board"] });
    const form = new URLSearchParams({ order: order(1).id, stage: "delivered" });
    expect((await app.request(`/orders/${token}/move`, { method: "POST", body: form })).status).toBe(404);
    expect(moved).toHaveLength(0);
  });
});
