import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Notice, ProductContext } from "../../../core/product.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { DocumentInput } from "../documents.js";
import { createQuoteProduct } from "../index.js";
import type { Variant } from "../pricing.js";
import type { OrderDetails, OrderStatus, OrderStore, SavedOrder } from "../store.js";
import type { Understander } from "../understand.js";
import { createDispatch, type DispatchOptions } from "./index.js";
import type { CourierService } from "./shipbubble.js";
import type { Delivery, DeliveryStore, Rider } from "./store.js";
import { createTracking, createTrackingLinks } from "./tracking.js";
import type { Zone } from "./zones.js";

const CUSTOMER = "2348012345678";
const OWNER = "2348000000001";
const MUSA = "2348031234567";
const SECRET = "test-secret";
const links = createTrackingLinks(SECRET, "https://bot.example.com");
const SHIP_KEY = "sb_sandbox_test";

const variants: Variant[] = [
  { id: "v-flyer", name: "Flyers: A5", minQuantity: 50, tiers: [{ minQuantity: 50, unitPriceKobo: 15_000 }] },
];
const zones: Zone[] = [
  { id: "z1", name: "Ikeja", areas: ["ikeja", "allen"], circle: { lat: 6.6018, lng: 3.3515, radiusM: 4000 }, feeKobo: 200_000 },
];

function memory() {
  const orders: Array<SavedOrder & { status: OrderStatus }> = [];
  const deliveries: Delivery[] = [];
  const riders: Rider[] = [];
  let ids = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

  const orderStore: OrderStore = {
    async createQuote(_contactId, lines, totalKobo) {
      const order = { id: `o${orders.length + 1}`, orderNumber: 1001 + orders.length, totalKobo, lines, status: "quoted" as OrderStatus };
      orders.push(order);
      return order;
    },
    async latestOpenQuote() {
      return [...orders].reverse().find((o) => o.status === "quoted") ?? null;
    },
    async setStatus(id, status) {
      const o = orders.find((x) => x.id === id);
      if (!o || o.status !== "quoted") return false;
      o.status = status;
      return true;
    },
    async findOrder(n): Promise<OrderDetails | null> {
      const o = orders.find((x) => x.orderNumber === n);
      return o ? { ...o, customerWaId: CUSTOMER, customerName: "Ada", createdAt: new Date(), paidAt: null } : null;
    },
    async markPaid(id) {
      const o = orders.find((x) => x.id === id);
      if (!o || !["quoted", "confirmed"].includes(o.status)) return false;
      o.status = "paid";
      return true;
    },
  };

  const store: DeliveryStore = {
    zones: async () => zones,
    riders: async () => riders,
    riderByWaId: async (waId) => riders.find((r) => r.waId === waId) ?? null,
    async addRider(name, waId) {
      const rider = { id: uuid(), name, waId };
      riders.push(rider);
      return rider;
    },
    async removeRider() {
      return false;
    },
    forOrder: async (orderId) => deliveries.find((d) => d.orderId === orderId) ?? null,
    get: async (id) => deliveries.find((d) => d.id === id) ?? null,
    activeForRider: async (waId) => deliveries.find((d) => d.riderWaId === waId && ["assigned", "picked_up"].includes(d.status)) ?? null,
    async start(n) {
      const d: Delivery = {
        ...n,
        id: uuid(),
        status: "asking",
        address: null,
        lat: null,
        lng: null,
        zoneName: null,
        feeKobo: null,
        riderId: null,
        riderName: null,
        riderWaId: null,
        riderLat: null,
        riderLng: null,
        riderSeenAt: null,
        courier: null,
      };
      deliveries.push(d);
      return d;
    },
    async update(id, from, change) {
      const d = deliveries.find((x) => x.id === id);
      if (!d || !from.includes(d.status)) return null;
      const { rider, ...rest } = change;
      Object.assign(d, rest);
      if (rider) Object.assign(d, { riderId: rider.id, riderName: rider.name, riderWaId: rider.waId, riderLat: null, riderLng: null, riderSeenAt: null });
      return { ...d };
    },
    async setQuoteTotal(orderId, totalKobo) {
      const o = orders.find((x) => x.id === orderId);
      if (!o || o.status !== "quoted") return false;
      o.totalKobo = totalKobo;
      return true;
    },
    async byCourierOrder(orderId) {
      const d = deliveries.find((x) => x.courier?.orderId === orderId);
      return d ? { ...d } : null;
    },
    async setRiderPosition(id, lat, lng, at) {
      const d = deliveries.find((x) => x.id === id);
      if (d && ["assigned", "picked_up"].includes(d.status)) Object.assign(d, { riderLat: lat, riderLng: lng, riderSeenAt: at });
    },
  };
  return { orders, deliveries, riders, orderStore, store };
}

function setup(planHasDelivery = true, courier?: DispatchOptions["courier"]) {
  const mem = memory();
  const drawn: DocumentInput[] = [];
  const seen: string[] = [];
  // Stands in for the AI: "yes" confirms, anything else asks for 100 flyers.
  const ai: Understander = {
    async understand({ text }) {
      seen.push(text);
      return /^yes$/i.test(text)
        ? { intent: "confirm", items: [], message: null }
        : { intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null };
    },
  };
  const dispatch = createDispatch({
    businessName: "KahnPrints",
    orderPrefix: "KP",
    ownerWaId: OWNER,
    pickup: "12 Allen Avenue, Ikeja",
    store: mem.store,
    orders: mem.orderStore,
    links,
    courier,
  });
  const product = createQuoteProduct({
    businessName: "KahnPrints",
    orderPrefix: "KP",
    ownerWaId: OWNER,
    catalog: { activeVariants: async () => variants },
    orders: mem.orderStore,
    ai,
    delivery: dispatch,
    features: { planCode: async () => "pro", has: async (f) => f !== "delivery" || planHasDelivery, limit: async () => null },
    renderDocument: async (input) => (drawn.push(input), new Uint8Array([0xff, 0xd8])),
    log: { error() {} },
  });
  const sent: Notice[] = [];
  const tracking = createTracking({
    secret: SECRET,
    publicUrl: "https://bot.example.com",
    store: mem.store,
    send: async (notices) => void sent.push(...notices),
    shipbubbleKey: SHIP_KEY,
  });
  return { ...mem, product, drawn, seen, tracking, sent };
}

let n = 0;
function from(sender: string, body: string, extra: Partial<IncomingMessage> = {}): IncomingMessage {
  return { waMessageId: `wamid.${++n}`, from: sender, contactName: "Ada", type: "text", text: body, timestamp: 1, raw: {}, ...extra };
}
const say = (body: string, extra: Partial<IncomingMessage> = {}) => from(CUSTOMER, body, extra);
function ctx(reachable = true): ProductContext {
  return {
    contactId: "c1",
    history: [],
    downloadMedia: async () => ({ data: new Blob([]), mimeType: "image/jpeg" }),
    sendLater: async () => {},
    canMessageFreely: async () => reachable,
  };
}

/** A customer who has asked for 100 flyers (₦15,000) and replied YES. */
async function quotedAndAsked() {
  const t = setup();
  await t.product.handle(say("100 flyers"), ctx());
  const asked = await t.product.handle(say("yes"), ctx());
  return { ...t, asked };
}

describe("delivery and the plan", () => {
  it("confirms straight away when the business's plan doesn't include delivery", async () => {
    const t = setup(false);
    await t.product.handle(say("100 flyers"), ctx());
    const yes = await t.product.handle(say("yes"), ctx());
    expect(yes?.locationRequest).toBeUndefined();
    expect(yes?.text).toContain("contact you shortly about delivery");
    expect(t.orders[0]?.status).toBe("confirmed");
  });
});

describe("delivery before the order", () => {
  it("asks where to deliver instead of confirming straight away", async () => {
    const { asked, orders } = await quotedAndAsked();
    expect(asked?.text).toBe("");
    expect(asked?.locationRequest).toContain("Tap *Send location*");
    expect(asked?.locationRequest).toContain("*PICKUP*");
    expect(orders[0]?.status).toBe("quoted");
  });

  it("prices a typed address from the zone table and shows the fee as its own line", async () => {
    const { product, orders, seen } = await quotedAndAsked();
    const reply = await product.handle(say("12 Allen Avenue, Ikeja"), ctx());
    expect(reply?.text).toBe("Delivery to 12 Allen Avenue, Ikeja (Ikeja): ₦2,000\nItems: ₦15,000\n*Total: ₦17,000*");
    expect(reply?.buttons?.buttons.map((b) => b.id)).toEqual(["yes", "change address"]);
    expect(orders[0]?.totalKobo).toBe(1_700_000);
    expect(seen).not.toContain("12 Allen Avenue, Ikeja");
  });

  it("prices a pin and puts the delivery on the invoice and the owner's alert", async () => {
    const { product, drawn } = await quotedAndAsked();
    await product.handle(say("", { type: "location", text: undefined, location: { latitude: 6.6, longitude: 3.35 } }), ctx());
    const confirmed = await product.handle(say("yes"), ctx());

    expect(confirmed?.text).toContain("Order KP-1001 is confirmed. Here's your invoice for ₦17,000.");
    expect(confirmed?.text).toContain("link to follow your delivery");
    expect(drawn[0]).toMatchObject({ totalKobo: 1_700_000, delivery: { label: "Delivery (Ikeja)", feeKobo: 200_000 } });
    const alert = confirmed?.notify?.[0]?.text ?? "";
    expect(alert).toContain("• Delivery (Ikeja) = ₦2,000");
    expect(alert).toContain("Total: ₦17,000");
    expect(alert).toContain("Deliver to: the pinned location");
    expect(alert).toContain("add rider Musa 0803 123 4567");
  });

  it("hands an address outside every zone to the owner to price", async () => {
    const { product, orders } = await quotedAndAsked();
    const reply = await product.handle(say("5 Ring Road, Ibadan, Oyo State"), ctx());
    expect(reply?.text).toContain("will confirm the delivery fee");
    expect(reply?.notify?.[0]).toMatchObject({ to: OWNER });
    expect(reply?.notify?.[0]?.text).toContain("Reply *fee KP-1001 2500*");

    const waiting = await product.handle(say("yes"), ctx());
    expect(waiting?.text).toContain("is confirming the delivery fee");
    expect(orders[0]?.status).toBe("quoted");

    const set = await product.handle(from(OWNER, "fee KP-1001 4,500"), ctx());
    expect(set?.text).toContain("delivery fee of ₦4,500 for KP-1001 (new total ₦19,500)");
    expect(set?.notify?.[0]).toMatchObject({ to: CUSTOMER, text: expect.stringContaining("*Total: ₦19,500*") });
    expect(orders[0]?.totalKobo).toBe(1_950_000);
  });

  it("lets the customer collect it instead, at the price of the items", async () => {
    const { product, orders, drawn } = await quotedAndAsked();
    const reply = await product.handle(say("pickup"), ctx());
    expect(reply?.text).toContain("you'll collect it from:\n12 Allen Avenue, Ikeja");
    expect(reply?.text).toContain("*Total: ₦15,000*");
    const confirmed = await product.handle(say("yes"), ctx());
    expect(confirmed?.text).toContain("let you know when it's ready");
    expect(confirmed?.notify?.[0]?.text).toContain("The customer will collect it.");
    expect(drawn[0]?.delivery).toBeUndefined();
    expect(orders[0]?.totalKobo).toBe(1_500_000);
  });

  it("leaves questions and short replies to the normal chat", async () => {
    const { product, seen } = await quotedAndAsked();
    await product.handle(say("how long does delivery take?"), ctx());
    expect(seen).toContain("how long does delivery take?");
  });
});

/** An order confirmed for delivery to Ikeja, with Musa saved as a rider. */
async function confirmedWithRider() {
  const t = await quotedAndAsked();
  await t.product.handle(say("12 Allen Avenue, Ikeja"), ctx());
  await t.product.handle(say("yes"), ctx());
  const added = await t.product.handle(from(OWNER, "add rider Musa 0803 123 4567"), ctx());
  return { ...t, added };
}

describe("sending a rider out", () => {
  it("saves a rider from a typed Nigerian number", async () => {
    const { added, riders } = await confirmedWithRider();
    expect(riders).toEqual([expect.objectContaining({ name: "Musa", waId: MUSA })]);
    expect(added?.text).toContain("Ask Musa to send *hi*");
  });

  it("sends the rider the job with buttons and the customer a tracking link", async () => {
    const { product, deliveries } = await confirmedWithRider();
    const reply = await product.handle(from(OWNER, "rider KP-1001 musa"), ctx());

    expect(deliveries[0]).toMatchObject({ status: "assigned", riderName: "Musa", riderWaId: MUSA });
    const [job, customer] = reply?.notify ?? [];
    expect(job?.to).toBe(MUSA);
    expect(job?.text).toContain("Pick up: 12 Allen Avenue, Ikeja");
    expect(job?.text).toContain("Deliver to: 12 Allen Avenue, Ikeja");
    expect(job?.text).toContain("Payment: not paid yet (₦17,000)");
    expect(job?.text).toContain(links.rider(deliveries[0]!));
    expect(job?.buttons?.buttons.map((b) => b.id)).toEqual(["picked KP-1001", "delivered KP-1001", "failed KP-1001"]);
    expect(customer).toMatchObject({ to: CUSTOMER, text: expect.stringContaining(links.customer(deliveries[0]!)) });
    expect(reply?.text).toContain("isn't marked paid yet");
  });

  it("warns the owner when the rider hasn't messaged in the last day", async () => {
    const { product } = await confirmedWithRider();
    const reply = await product.handle(from(OWNER, "rider KP-1001 Musa"), ctx(false));
    expect(reply?.text).toContain("Musa hasn't messaged this number in the last 24 hours");
    expect(reply?.text).toContain("New delivery KP-1001 from KahnPrints");
  });

  it("refuses an unknown rider and a quote that isn't an order yet", async () => {
    const { product } = await confirmedWithRider();
    expect((await product.handle(from(OWNER, "rider KP-1001 Tunde"), ctx()))?.text).toContain("add rider Tunde 0803 123 4567");
    await product.handle(say("100 flyers"), ctx());
    expect((await product.handle(from(OWNER, "rider KP-1002 Musa"), ctx()))?.text).toBe("KP-1002 hasn't been confirmed by the customer yet.");
  });

  it("moves the job on from the rider's buttons, once", async () => {
    const { product, deliveries } = await confirmedWithRider();
    await product.handle(from(OWNER, "rider KP-1001 Musa"), ctx());

    const picked = await product.handle(from(MUSA, "picked KP-1001", { type: "interactive" }), ctx());
    expect(picked?.text).toBe("KP-1001: Thanks! The customer knows you're on the way.");
    expect(picked?.notify?.map((x) => x.to)).toEqual([CUSTOMER, OWNER]);
    expect(picked?.notify?.[0]?.text).toContain(links.customer(deliveries[0]!));

    const again = await product.handle(from(MUSA, "picked KP-1001"), ctx());
    expect(again?.text).toBe("KP-1001 is already marked picked up.");
    expect(again?.notify).toBeUndefined();

    const done = await product.handle(from(MUSA, "delivered"), ctx());
    expect(done?.notify?.[0]?.text).toBe("Your order KP-1001 has been delivered. Thank you for choosing KahnPrints!");
    expect(deliveries[0]?.status).toBe("delivered");
  });

  it("takes a rider's pin, and explains that live location doesn't reach the bot", async () => {
    const { product, deliveries } = await confirmedWithRider();
    await product.handle(from(OWNER, "rider KP-1001 Musa"), ctx());
    const pin = await product.handle(from(MUSA, "", { type: "location", text: undefined, location: { latitude: 6.59, longitude: 3.34 } }), ctx());
    expect(pin?.text).toContain("Got your location for KP-1001");
    expect(deliveries[0]).toMatchObject({ riderLat: 6.59, riderLng: 3.34 });
    const live = await product.handle(from(MUSA, "", { type: "unsupported", text: undefined }), ctx());
    expect(live?.text).toContain("WhatsApp doesn't pass live location on to me");
  });

  it("cancels a paid delivery and reminds the owner about the refund", async () => {
    const { product, orders } = await confirmedWithRider();
    await product.handle(from(OWNER, "rider KP-1001 Musa"), ctx());
    orders[0]!.status = "paid";
    const reply = await product.handle(from(OWNER, "cancel delivery KP-1001"), ctx());
    expect(reply?.text).toContain("I've told the customer and Musa");
    expect(reply?.text).toContain("refund it from your Paystack dashboard");
    expect(reply?.notify?.map((x) => x.to)).toEqual([CUSTOMER, MUSA]);
  });
});

describe("tracking pages", () => {
  async function onTheRoad() {
    const t = await confirmedWithRider();
    await t.product.handle(from(OWNER, "rider KP-1001 Musa"), ctx());
    return { ...t, d: t.deliveries[0]! };
  }
  const path = (url: string) => new URL(url).pathname;

  it("refuses a link whose signature was changed", async () => {
    const { tracking, d } = await onTheRoad();
    const forged = path(links.customer(d)).slice(0, -2) + "xx";
    expect((await tracking.request(forged)).status).toBe(404);
    // The rider's link and the customer's link can't be swapped.
    expect((await tracking.request(path(links.customer(d)).replace("/track/", "/ride/"))).status).toBe(404);
  });

  it("shows the customer where the rider's page last was", async () => {
    const { tracking, d } = await onTheRoad();
    const ride = path(links.rider(d));
    expect((await tracking.request(ride)).status).toBe(200);
    const res = await tracking.request(`${ride}/where`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: 6.595, lng: 3.345 }),
    });
    expect(await res.json()).toEqual({ status: "assigned", sharing: true });

    const page = await tracking.request(path(links.customer(d)));
    expect(await page.text()).toContain("Order KP-1001");
    const now = await (await tracking.request(`${path(links.customer(d))}/now`)).json();
    expect(now).toMatchObject({ status: "assigned", rider: { name: "Musa", lat: 6.595, lng: 3.345 } });
  });

  it("marks a delivery done from the rider's page and stops sharing after", async () => {
    const { tracking, d, sent } = await onTheRoad();
    const ride = path(links.rider(d));
    const step = (s: string) =>
      tracking.request(`${ride}/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: s }) });
    expect(await (await step("delivered")).json()).toEqual({ status: "delivered", changed: true });
    expect(await (await step("delivered")).json()).toEqual({ status: "delivered", changed: false });
    expect(sent.map((x) => x.to)).toEqual([CUSTOMER, OWNER]);

    const res = await tracking.request(`${ride}/where`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: 6.6, lng: 3.35 }),
    });
    expect(await res.json()).toEqual({ status: "delivered", sharing: false });
  });
});

describe("couriers through Shipbubble", () => {
  function courierSetup(quote: Awaited<ReturnType<CourierService["quote"]>> | Error = {
    feeKobo: 350_000, courierName: "Kwik", courierId: "kwik", serviceCode: "kwik_express", requestToken: "tok", pickupEta: "Within 2 hours", deliveryEta: "Within 5 hrs",
  }) {
    const service = {
      quote: vi.fn(async () => {
        if (quote instanceof Error) throw quote;
        return quote;
      }),
      book: vi.fn(async () => ({ orderId: "SB-1", trackingUrl: "https://track.example/SB-1", courierName: "Kwik", courierPhone: "0800" })),
    };
    const payLink = vi.fn(async () => "https://checkout.paystack.com/courier");
    const t = setup(true, { service, from: { name: "KahnPrints", phone: OWNER, address: "12 Allen Avenue, Ikeja" }, payLink });
    return { ...t, service, payLink };
  }
  async function offered(quote?: Parameters<typeof courierSetup>[0]) {
    const t = courierSetup(quote);
    await t.product.handle(say("100 flyers"), ctx());
    await t.product.handle(say("yes"), ctx());
    const reply = await t.product.handle(say("5 Ring Road, Ibadan, Oyo State"), ctx());
    return { ...t, reply };
  }

  it("offers the courier's own price for an address outside every zone, and adds it to the total", async () => {
    const { reply, orders, service, deliveries } = await offered();
    expect(service.quote).toHaveBeenCalledWith(
      expect.objectContaining({ address: "12 Allen Avenue, Ikeja" }),
      expect.objectContaining({ phone: CUSTOMER, address: "5 Ring Road, Ibadan, Oyo State" }),
      [{ name: "Flyers: A5", quantity: 100, unitKobo: 15_000 }],
    );
    expect(reply?.text).toContain("by Kwik (within 5 hrs): ₦3,500");
    expect(reply?.text).toContain("*Total: ₦18,500*");
    expect(orders[0]?.totalKobo).toBe(1_850_000);
    expect(deliveries[0]?.courier).toMatchObject({ name: "Kwik", requestToken: "tok" });
  });

  it("falls back to the owner pricing it when no courier can", async () => {
    const none = await offered(null);
    expect(none.reply?.text).toContain("will confirm the delivery fee");
    const broken = await offered(new Error("Shipbubble down"));
    expect(broken.reply?.text).toContain("will confirm the delivery fee");
  });

  it("books the courier once the fee is paid online, only once, and tells the customer and owner", async () => {
    const t = await offered();
    await t.product.handle(say("yes"), ctx());
    expect(t.orders[0]?.status).toBe("confirmed");
    const notes = await t.product.orderPaid(1001, { how: "online", feeKobo: 0, courierKobo: 350_000 });
    expect(t.service.book).toHaveBeenCalledWith(expect.objectContaining({ requestToken: "tok", courierId: "kwik", serviceCode: "kwik_express" }));
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: CUSTOMER, text: expect.stringContaining("Kwik will deliver your order KP-1001") }),
        expect.objectContaining({ to: OWNER, text: expect.stringContaining("🚚 Kwik is booked for KP-1001") }),
      ]),
    );
    expect(t.deliveries[0]?.status).toBe("assigned");
    expect(await t.product.courierPaid(1001)).toEqual([]);
    expect(t.service.book).toHaveBeenCalledTimes(1);
  });

  it("gives the owner a link to pay the courier fee when the customer paid them directly", async () => {
    const t = await offered();
    await t.product.handle(say("yes"), ctx());
    const paid = await t.product.orderPaid(1001, { how: "app" });
    expect(paid.find((n) => n.to === OWNER)?.text).toContain("reply *courier KP-1001*");
    expect(t.service.book).not.toHaveBeenCalled();
    const link = await t.product.handle(from(OWNER, "courier KP-1001"), ctx());
    expect(link?.text).toContain("https://checkout.paystack.com/courier");
    expect(t.payLink).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 1001 }), 350_000);
    await t.product.courierPaid(1001);
    expect(t.service.book).toHaveBeenCalledTimes(1);
  });

  it("follows Shipbubble's signed webhooks, ignoring unsigned ones and repeats", async () => {
    const t = await offered();
    await t.product.handle(say("yes"), ctx());
    await t.product.orderPaid(1001, { how: "online", feeKobo: 0, courierKobo: 350_000 });
    const post = (body: object, signature?: string) => {
      const raw = JSON.stringify(body);
      return t.tracking.request("/webhooks/shipbubble", {
        method: "POST",
        body: raw,
        headers: { "x-ship-signature": signature ?? createHmac("sha512", SHIP_KEY).update(raw).digest("hex") },
      });
    };
    expect((await post({ event: "shipment.status.changed", order_id: "SB-1", status: "picked_up" }, "00")).status).toBe(401);
    expect(t.sent).toHaveLength(0);
    expect((await post({ event: "shipment.status.changed", order_id: "SB-1", status: "picked_up" })).status).toBe(200);
    expect((await post({ event: "shipment.status.changed", order_id: "SB-1", status: "in_transit" })).status).toBe(200);
    expect((await post({ event: "shipment.status.changed", order_id: "SB-1", status: "completed" })).status).toBe(200);
    expect(t.deliveries[0]?.status).toBe("delivered");
    expect(t.sent.filter((n) => n.to === CUSTOMER).map((n) => n.text)).toEqual([
      expect.stringContaining("Kwik has picked up your order KP-1001"),
      expect.stringContaining("has been delivered"),
    ]);
  });
});
