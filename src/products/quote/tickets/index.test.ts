import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { QuoteLine, Variant } from "../pricing.js";
import { createEventTickets, ticketLabel } from "./index.js";
import { BUSINESS, links, memoryTickets } from "./testing.js";
import type { TicketCardInput, TicketPosterInput } from "./card.js";

const OWNER = "2348000000001";

function text(body: string, from = "2348012345678"): IncomingMessage {
  return { waMessageId: `wamid.${body}`, from, contactName: "Ada", type: "text", text: body, timestamp: 1, raw: {} };
}

const line = (variantId: string, name: string, quantity: number, unit = 1_000_000): QuoteLine => ({
  variantId,
  name,
  quantity,
  unitPriceKobo: unit,
  totalKobo: unit * quantity,
});

function setup(onPlan = true) {
  const mem = memoryTickets();
  const drawn: TicketCardInput[] = [];
  const posters: TicketPosterInput[] = [];
  const tickets = createEventTickets({
    businessId: BUSINESS,
    businessName: "Element House",
    orderPrefix: "EH",
    store: mem.store,
    links,
    features: { has: async () => onPlan, limit: async () => null } as never,
    draw: (input) => {
      drawn.push(input);
      return Buffer.from([0xff, 0xd8]);
    },
    drawPoster: (input) => {
      posters.push(input);
      return Buffer.from([0xff, 0xd8]);
    },
  });
  return { ...mem, saved: mem.tickets, tickets, drawn, posters };
}

const order = (lines: QuoteLine[]) => ({ id: "o1", orderNumber: 214, lines, customerWaId: "2348012345678", customerName: "Ada" });

describe("event tickets", () => {
  it("knows a tickets-only order from one with other things in it", async () => {
    const { tickets } = setup();
    expect(await tickets.ticketsOnly([line("v-vip", "Element House: VIP", 2)])).toBe(true);
    expect(await tickets.ticketsOnly([line("v-vip", "Element House: VIP", 2), line("v-tee", "T-shirt", 1)])).toBe(false);
    expect(await setup(false).tickets.ticketsOnly([line("v-vip", "Element House: VIP", 2)])).toBe(false);
  });

  it("makes one ticket with its own QR code and code for every ticket paid for, once", async () => {
    const { tickets, drawn, addOrder, saved } = setup();
    addOrder("o1", 214);
    const note = await tickets.paid(order([line("v-vip", "Element House: VIP", 2), line("v-regular", "Element House: Regular", 1), line("v-tee", "T-shirt", 1)]));
    expect(note?.to).toBe("2348012345678");
    expect(note?.text).toContain("Your 3 tickets for Element House");
    expect(note?.images).toHaveLength(3);
    expect(saved.map((t) => [t.seat, t.name])).toEqual([
      [1, "Element House: VIP"],
      [2, "Element House: VIP"],
      [3, "Element House: Regular"],
    ]);
    expect(new Set(saved.map((t) => t.code)).size).toBe(3);
    expect(drawn[0]).toMatchObject({ seat: 1, of: 3, holderName: "Ada", code: `EH-214 · ${saved[0]!.code}` });
    expect(drawn[0]!.qrText).toBe(links.ticket(BUSINESS, saved[0]!.id));

    const again = await tickets.paid(order([line("v-vip", "Element House: VIP", 2), line("v-regular", "Element House: Regular", 1)]));
    expect(again?.images).toHaveLength(3);
    expect(saved).toHaveLength(3);
  });

  it("sends nothing for an order without tickets", async () => {
    const { tickets } = setup();
    expect(await tickets.paid(order([line("v-tee", "T-shirt", 1)]))).toBeNull();
  });

  it("resends a customer's unused tickets on 'my tickets'", async () => {
    const { tickets, addOrder, store } = setup();
    expect((await tickets.customerMessage(text("my tickets"), "c1", "en"))?.text).toBe("You don't have any unused tickets right now.");
    addOrder("o1", 214);
    await tickets.paid(order([line("v-vip", "Element House: VIP", 2)]));
    await store.checkIn((await store.forOrder("o1"))[0]!.id);
    const reply = await tickets.customerMessage(text("Send my tickets"), "c1", "en");
    expect(reply?.text).toContain("Here are your tickets (1)");
    expect(reply?.images?.[0]?.caption).toBe("Element House: VIP · ticket 2 of 2");
    expect(await tickets.customerMessage(text("tickets"), "c1", "en")).toBeNull();
  });

  it("lets the owner mark products as tickets and get the door link", async () => {
    const { tickets, products } = setup();
    const list = await tickets.ownerCommand(text("tickets", OWNER));
    expect(list?.text).toContain("1. Element House: Regular 🎟");
    expect(list?.text).toContain("3. T-shirt\n");
    expect((await tickets.ownerCommand(text("ticket 3 on", OWNER)))?.text).toContain("T-shirt is now a ticket");
    expect(products[2]!.ticket).toBe(true);
    expect((await tickets.ownerCommand(text("ticket 9 off", OWNER)))?.text).toContain("There's no product 9");
    expect((await tickets.ownerCommand(text("door", OWNER)))?.text).toContain(links.door(BUSINESS));
    expect(await tickets.ownerCommand(text("hello", OWNER))).toBeNull();
    expect((await setup(false).tickets.ownerCommand(text("tickets", OWNER)))?.text).toContain("Starter and above");
  });

  describe("ticket cards to swipe through", () => {
    const priced = (id: string, name: string, naira: number, minQuantity = 1): Variant => ({ id, name, minQuantity, tiers: [{ minQuantity, unitPriceKobo: naira * 100 }] });
    const variants = [priced("v-vip", "Element House: VIP", 50_000), priced("v-regular", "Element House: Regular", 10_000), priced("v-tee", "T-shirt", 8_000)];

    it("shows one card per ticket type, cheapest first, priced from the price list", async () => {
      const { tickets, posters } = setup();
      const reply = await tickets.showcase(variants, "en");
      expect(reply?.text).toBe("");
      expect(reply?.carousel?.body).toBe("🎟 Tickets for *Element House*\n\nSwipe to pick your ticket, then tap *Get your ticket*.");
      expect(reply?.carousel?.cards.map((c) => c.body)).toEqual(["*Element House: Regular*\n₦10,000", "*Element House: VIP*\n₦50,000"]);
      expect(reply?.carousel?.cards[1]?.button).toEqual({ id: "Get my ticket: Element House: VIP", title: "Get your ticket" });
      // The same cards one by one, in case WhatsApp turns the swipe message down.
      expect(reply?.cards).toHaveLength(2);
      expect(posters.map((p) => [p.event, p.ticket, p.price])).toEqual([
        ["Element House", "Regular", "₦10,000"],
        ["Element House", "VIP", "₦50,000"],
      ]);
    });

    it("leaves out sold-out tickets and says when few are left", async () => {
      const { tickets, stock } = setup();
      stock["v-regular"] = 0;
      stock["v-vip"] = 4;
      const reply = await tickets.showcase(variants, "en", undefined, "How many VIP tickets do you need?");
      expect(reply?.carousel).toBeUndefined();
      expect(reply?.text).toBe("How many VIP tickets do you need?\n\nTap *Get your ticket* for yours.");
      expect(reply?.cards?.[0]?.body).toBe("*Element House: VIP*\n₦50,000\nOnly 4 left!");
    });

    it("shows nothing without tickets on sale or off the plan", async () => {
      expect(await setup().tickets.showcase([variants[2]!], "en")).toBeNull();
      expect(await setup(false).tickets.showcase(variants, "en")).toBeNull();
    });

    it("knows a tap on Get your ticket, a request for tickets and an event's own shop", async () => {
      const { tickets } = setup();
      expect(tickets.tapped("Get my ticket: Element House: VIP", variants, "en")?.variant.id).toBe("v-vip");
      expect(tickets.tapped("Get my ticket: Nothing", variants, "en")).toBeNull();
      expect(["tickets", "Buy tickets please", "how much are your tickets?", "billets"].every((t) => tickets.asksForTickets(t))).toBe(true);
      expect(tickets.asksForTickets("2 VIP tickets")).toBe(false);
      expect(await tickets.allTickets(variants.slice(0, 2))).toBe(true);
      expect(await tickets.allTickets(variants)).toBe(false);
    });

    it("leaves the price list's default option off a card", () => {
      expect(ticketLabel("TEDx 28 Nov", "TEDx 28 Nov: Standard")).toEqual({ title: "TEDx 28 Nov", event: "", type: "TEDx 28 Nov" });
      expect(ticketLabel("TEDx 28 Nov", "TEDx 28 Nov: VIP")).toEqual({ title: "TEDx 28 Nov: VIP", event: "TEDx 28 Nov", type: "VIP" });
    });
  });
});
