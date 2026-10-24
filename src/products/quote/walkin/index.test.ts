import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { PlanFeatures } from "../features.js";
import type { SavedOrder } from "../store.js";
import { COUNTER, createWalkIn } from "./index.js";
import { readPickupToken } from "./links.js";
import { BUSINESS, links, memoryWalkIn, plan, SECRET } from "./testing.js";

const ORDER_ID = "00000000-0000-0000-0000-00000000a001";
const order: SavedOrder = {
  id: ORDER_ID,
  orderNumber: 214,
  totalKobo: 900_000,
  lines: [
    { variantId: "v-beer", name: "Drinks: Desperados", quantity: 2, unitPriceKobo: 300_000, totalKobo: 600_000 },
    { variantId: "v-rice", name: "Jollof rice: Plate", quantity: 1, unitPriceKobo: 300_000, totalKobo: 300_000 },
  ],
};

function say(text: string, from = "2348000000001"): IncomingMessage {
  return { waMessageId: `wamid.${text}`, from, type: "text", text, timestamp: 1, raw: {} };
}

function setup(features?: PlanFeatures) {
  const mem = memoryWalkIn();
  const walkIn = createWalkIn({ businessId: BUSINESS, orderPrefix: "EH", store: mem.store, links, features });
  return { walkIn, ...mem };
}

describe("walk-in orders", () => {
  it("is off until the owner switches it on, and only on plans that include it", async () => {
    const { walkIn, settings } = setup();
    expect(await walkIn.mode()).toEqual({ on: false, paused: false });
    expect((await walkIn.ownerCommand(say("walk-in on")))?.text).toContain("Walk-in orders are on");
    expect(settings.walkIn).toBe(true);
    expect(await walkIn.mode()).toEqual({ on: true, paused: false });

    const free = setup(plan({ walk_in: false }));
    free.settings.walkIn = true;
    expect(await free.walkIn.mode()).toEqual({ on: false, paused: false });
    expect((await free.walkIn.ownerCommand(say("walk-in on")))?.text).toContain("Starter and above");
  });

  it("closes and opens new orders", async () => {
    const { walkIn, settings } = setup();
    settings.walkIn = true;
    await walkIn.ownerCommand(say("close orders"));
    expect(await walkIn.mode()).toEqual({ on: true, paused: true });
    await walkIn.ownerCommand(say("Open orders"));
    expect(await walkIn.mode()).toEqual({ on: true, paused: false });
  });

  it("leaves other owner messages alone", async () => {
    const { walkIn } = setup();
    expect(await walkIn.ownerCommand(say("paid EH-214"))).toBeNull();
    expect(await walkIn.ownerCommand(say("2 beers please"))).toBeNull();
  });

  it("sends products to screens, within the plan's number of screens", async () => {
    const { walkIn, products } = setup(plan({ stations: 2 }));
    expect((await walkIn.ownerCommand(say("stations")))?.text).toContain("1. Drinks: Counter");
    expect((await walkIn.ownerCommand(say("station 1 bar")))?.text).toBe("Drinks now goes to the Bar screen. Send *screens* for its link.");
    expect(products[0]!.station).toBe("Bar");
    expect((await walkIn.ownerCommand(say("station 2 Kitchen")))?.text).toContain("up to 2 pickup screens");
    expect((await walkIn.ownerCommand(say("station 3 BAR")))?.text).toContain("the Bar screen");
    expect(products[2]!.station).toBe("Bar");
    // Once nothing is left on the Counter, Bar and Kitchen fit in two screens.
    expect((await walkIn.ownerCommand(say("station 2 kitchen")))?.text).toContain("the Kitchen screen");
    expect((await walkIn.ownerCommand(say("station 9 bar")))?.text).toContain("no product 9");
    await walkIn.ownerCommand(say("station 1 off"));
    expect(products[0]!.station).toBeNull();
  });

  it("gives the owner a screen link per station, plus one for everything", async () => {
    const { walkIn, products } = setup();
    products[0]!.station = "Bar";
    const text = (await walkIn.ownerCommand(say("screens")))!.text;
    expect(text).toContain("• Every order: https://bot.example.com/screen/");
    expect(text).toContain("• Bar: https://bot.example.com/screen/");
    expect(text).toContain(`• ${COUNTER}: https://bot.example.com/screen/`);
  });

  it("remembers the table a customer says they're at for their next order", async () => {
    const { walkIn, addOrder, orders } = setup();
    expect((await walkIn.customerMessage(say("Table 7"), "c1"))?.text).toContain("you're at Table 7");
    expect(await walkIn.customerMessage(say("2 beers and a jollof"), "c1")).toBeNull();
    expect(await walkIn.customerMessage(say("I'm at booth b2"), "c2")).not.toBeNull();

    addOrder(ORDER_ID, 214);
    const { code, table } = await walkIn.confirmed(order, "c1");
    expect(code).toMatch(/^\d{4}$/);
    expect(table).toBe("Table 7");
    expect(orders.get(ORDER_ID)).toMatchObject({ pickupCode: code, tableLabel: "Table 7" });
  });

  it("splits a paid order into a ticket per screen, once, and draws the pickup box", async () => {
    const { walkIn, addOrder, products, tickets } = setup();
    products[0]!.station = "Bar";
    products[1]!.station = "Kitchen";
    addOrder(ORDER_ID, 214);
    await walkIn.confirmed(order, "c1");
    const box = await walkIn.paid(order);
    expect(box).toMatchObject({ stations: ["Bar", "Kitchen"] });
    expect(box!.code).toMatch(/^EH-214 · \d{4}$/);
    expect(readPickupToken(SECRET, box!.qrText.split("/pickup/")[1]!)).toEqual({ businessId: BUSINESS, orderId: ORDER_ID });
    expect(tickets.map((t) => [t.station, t.items])).toEqual([
      ["Bar", "2 x Drinks: Desperados"],
      ["Kitchen", "1 x Jollof rice: Plate"],
    ]);

    await walkIn.paid(order);
    expect(tickets).toHaveLength(2);
    expect(await walkIn.pickup(order)).toMatchObject({ stations: ["Bar", "Kitchen"] });
  });

  it("does nothing for orders taken before walk-in was on", async () => {
    const { walkIn, addOrder, tickets } = setup();
    addOrder(ORDER_ID, 214, "paid");
    expect(await walkIn.paid(order)).toBeNull();
    expect(await walkIn.pickup(order)).toBeNull();
    expect(tickets).toHaveLength(0);
  });
});
