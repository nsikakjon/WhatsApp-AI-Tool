import { describe, expect, it } from "vitest";
import type { Notice } from "../../../core/product.js";
import { BUSINESS, links, memoryWalkIn, SECRET } from "./testing.js";
import { ALL_STATIONS } from "./links.js";
import { createWalkInScreens } from "./screens.js";

const ORDER_ID = "00000000-0000-0000-0000-00000000a001";

function setup() {
  const mem = memoryWalkIn();
  const sent: Array<{ notices: Notice[]; from: string | null }> = [];
  const paidAtCounter: number[] = [];
  const app = createWalkInScreens({
    secret: SECRET,
    business: async (id) =>
      id === BUSINESS
        ? {
            name: "Element House",
            orderPrefix: "EH",
            store: mem.store,
            fromNumberId: "111",
            async paidAtCounter(n) {
              paidAtCounter.push(n);
              return [{ to: "2348012345678", text: "receipt" }];
            },
          }
        : null,
    send: async (notices, from) => {
      sent.push({ notices, from });
    },
  });
  const o = mem.addOrder(ORDER_ID, 214, "paid");
  o.pickupCode = "4827";
  o.tableLabel = null;
  return { app, sent, paidAtCounter, ...mem };
}

const path = (url: string) => new URL(url).pathname;
const post = (app: ReturnType<typeof setup>["app"], url: string, form: Record<string, string>) =>
  app.request(url, { method: "POST", body: new URLSearchParams(form), headers: { "Content-Type": "application/x-www-form-urlencoded" } });

describe("walk-in screens", () => {
  it("refuses a made-up screen link", async () => {
    const { app } = setup();
    const real = path(links.screen(BUSINESS, "Bar"));
    expect((await app.request(real.replace(/.$/, real.endsWith("A") ? "B" : "A"))).status).toBe(404);
    expect((await app.request(path(links.screen(BUSINESS, "Bar")))).status).toBe(200);
  });

  it("shows a station only its own tickets, and the all-orders screen every ticket", async () => {
    const { app, store } = setup();
    await store.createTickets(ORDER_ID, [
      { station: "Bar", items: "2 x Drinks: Desperados" },
      { station: "Kitchen", items: "1 x Jollof rice: Plate" },
    ]);
    const bar = await (await app.request(`${path(links.screen(BUSINESS, "Bar"))}/list`)).text();
    expect(bar).toContain("Desperados");
    expect(bar).not.toContain("Jollof");
    const all = await (await app.request(`${path(links.screen(BUSINESS, ALL_STATIONS))}/list`)).text();
    expect(all).toContain("Desperados");
    expect(all).toContain("Jollof");
  });

  it("tells the customer when their ticket is ready, once", async () => {
    const { app, store, sent, tickets } = setup();
    await store.createTickets(ORDER_ID, [{ station: "Bar", items: "2 x Drinks: Desperados" }]);
    const screen = path(links.screen(BUSINESS, "Bar"));
    await post(app, `${screen}/ready`, { ticket: tickets[0]!.id });
    await post(app, `${screen}/ready`, { ticket: tickets[0]!.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      notices: [
        {
          to: "2348012345678",
          text: "Your order EH-214 is ready at the Bar (2 x Drinks: Desperados). Show the QR code on your receipt to collect it.",
        },
      ],
      from: "111",
    });
  });

  it("hands an order over once from a scanned QR code, and warns on a second scan", async () => {
    const { app, store, tickets } = setup();
    await store.createTickets(ORDER_ID, [{ station: "Bar", items: "2 x Drinks: Desperados" }]);
    const screen = path(links.screen(BUSINESS, "Bar"));

    const found = await post(app, `${screen}/find`, { code: links.pickup(BUSINESS, ORDER_ID) });
    expect(found.status).toBe(303);
    const orderPage = found.headers.get("location")!;
    expect(orderPage).toBe(`${screen}/order/${ORDER_ID}`);
    expect(await (await app.request(orderPage)).text()).toContain("Hand over");

    await post(app, `${screen}/collect`, { ticket: tickets[0]!.id, order: ORDER_ID });
    expect(tickets[0]!.status).toBe("collected");
    const again = await post(app, `${screen}/collect`, { ticket: tickets[0]!.id, order: ORDER_ID });
    expect(again.headers.get("location")).toContain("?note=already");
    expect(await (await app.request(orderPage)).text()).toContain("Already collected at");
  });

  it("finds an order by its number and typed code, and not by a wrong code", async () => {
    const { app } = setup();
    const screen = path(links.screen(BUSINESS, "Bar"));
    expect((await post(app, `${screen}/find`, { code: "EH-214 4827" })).headers.get("location")).toBe(`${screen}/order/${ORDER_ID}`);
    expect((await post(app, `${screen}/find`, { code: "214 1111" })).headers.get("location")).toContain("?note=");
  });

  it("won't accept another business's QR code", async () => {
    const { app } = setup();
    const screen = path(links.screen(BUSINESS, "Bar"));
    const other = links.pickup("00000000-0000-0000-0000-000000000003", ORDER_ID);
    expect((await post(app, `${screen}/find`, { code: other })).headers.get("location")).toContain("?note=");
  });

  it("says not to hand over an unpaid order, and takes payment at the counter", async () => {
    const { app, orders, sent, paidAtCounter } = setup();
    orders.get(ORDER_ID)!.status = "confirmed";
    const screen = path(links.screen(BUSINESS, ALL_STATIONS));
    expect(await (await app.request(`${screen}/order/${ORDER_ID}`)).text()).toContain("Not paid yet");
    expect(await (await app.request(`${screen}/list`)).text()).toContain("Paid at counter");
    await post(app, `${screen}/paid`, { order: "214" });
    expect(paidAtCounter).toEqual([214]);
    expect(sent[0]).toEqual({ notices: [{ to: "2348012345678", text: "receipt" }], from: "111" });
  });

  it("sends a customer who scans their own code to a status page", async () => {
    const { app, store } = setup();
    await store.createTickets(ORDER_ID, [{ station: "Bar", items: "2 x Drinks: Desperados" }]);
    const page = await (await app.request(path(links.pickup(BUSINESS, ORDER_ID)))).text();
    expect(page).toContain("EH-214");
    expect(page).toContain("being made");
    expect((await app.request(`/pickup/${BUSINESS}.${ORDER_ID}.wrong`)).status).toBe(404);
  });

  it("serves the QR reader for phones without a built-in one", async () => {
    const { app } = setup();
    const res = await app.request("/screen/assets/jsQR.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("jsQR");
  });
});
