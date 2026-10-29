import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createQuoteProduct, safeMessage } from "./index.js";
import type { QuoteLine, Variant } from "./pricing.js";
import type { BrandingStore, CatalogStore, OrderStore, SavedOrder } from "./store.js";
import type { DocumentInput } from "./documents.js";
import type { Understander, Understanding } from "./understand.js";
import type { PlanGate } from "./plan.js";
import type { Dispatch } from "./delivery/index.js";
import { createWalkIn } from "./walkin/index.js";
import { BUSINESS, links, memoryWalkIn } from "./walkin/testing.js";
import { welcomeAsk } from "./welcome.js";

const variants: Variant[] = [
  {
    id: "v-flyer",
    name: "Flyers: A5, double-sided",
    minQuantity: 50,
    tiers: [
      { minQuantity: 50, unitPriceKobo: 15_000 },
      { minQuantity: 500, unitPriceKobo: 10_000 },
    ],
  },
  { id: "v-card", name: "Business cards: 350gsm matte", minQuantity: 100, tiers: [{ minQuantity: 100, unitPriceKobo: 5_000 }] },
  { id: "v-dtf", name: "DTF transfers: A3", minQuantity: 1, tiers: [] },
];

function memoryOrders() {
  const orders: Array<SavedOrder & { contactId: string; status: string; paidAt?: Date }> = [];
  const store: OrderStore = {
    async createQuote(contactId, lines: QuoteLine[], totalKobo) {
      const order = { id: `o${orders.length + 1}`, orderNumber: 1001 + orders.length, totalKobo, lines, contactId, status: "quoted" };
      orders.push(order);
      return order;
    },
    async latestOpenQuote(contactId) {
      return [...orders].reverse().find((o) => o.contactId === contactId && o.status === "quoted") ?? null;
    },
    async setStatus(orderId, status) {
      const o = orders.find((x) => x.id === orderId);
      if (!o || o.status !== "quoted") return false;
      o.status = status;
      return true;
    },
    async findOrder(orderNumber) {
      const o = orders.find((x) => x.orderNumber === orderNumber);
      if (!o) return null;
      return {
        ...o,
        status: o.status as "quoted",
        customerWaId: "2348012345678",
        customerName: "Ada",
        createdAt: new Date("2026-10-14T09:00:00Z"),
        paidAt: o.paidAt ?? null,
      };
    },
    async markPaid(orderId) {
      const o = orders.find((x) => x.id === orderId);
      if (!o || !["quoted", "confirmed"].includes(o.status)) return false;
      o.status = "paid";
      o.paidAt = new Date("2026-10-15T09:00:00Z");
      return true;
    },
  };
  return { store, orders };
}

/** Records what was drawn instead of drawing it. */
function fakeDocuments() {
  const drawn: DocumentInput[] = [];
  const render = async (input: DocumentInput) => {
    drawn.push(input);
    return new Uint8Array([0xff, 0xd8]);
  };
  return { drawn, render };
}

function memoryBranding() {
  const saved: Array<{ data: Uint8Array; mimeType: string }> = [];
  const branding: BrandingStore = {
    logo: async () => saved.at(-1)?.data ?? null,
    saveLogo: async (data, mimeType) => {
      saved.push({ data, mimeType });
    },
  };
  return { branding, saved };
}

function setup(answer: Understanding | Error, catalog: Variant[] = variants) {
  const mem = memoryOrders();
  const seen: Array<Parameters<Understander["understand"]>[0]> = [];
  const ai: Understander = {
    async understand(input) {
      seen.push(input);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const catalogStore: CatalogStore = { activeVariants: async () => catalog };
  const docs = fakeDocuments();
  const brand = memoryBranding();
  const product = createQuoteProduct({
    businessName: "KahnPrints",
    orderPrefix: "KP",
    ownerWaId: OWNER,
    catalog: catalogStore,
    orders: mem.store,
    ai,
    branding: brand.branding,
    paymentDetails: "Bank 0000000000",
    renderDocument: docs.render,
    log: { error() {} },
  });
  return { product, seen, drawn: docs.drawn, logos: brand.saved, ...mem };
}

const OWNER = "2348000000001";

function text(body: string): IncomingMessage {
  return { waMessageId: `wamid.${body}`, from: "2348012345678", contactName: "Ada", type: "text", text: body, timestamp: 1, raw: {} };
}
const ctx = {
  contactId: "c1",
  history: [],
  downloadMedia: async () => ({ data: new Blob([]), mimeType: "image/jpeg" }),
  sendLater: async () => {},
  canMessageFreely: async () => true,
};

describe("quote product", () => {
  it("records STOP as a reminder opt-out without asking the AI, only when follow-ups are on", async () => {
    const { seen, orders } = setup(new Error("unused"));
    const optedOut: string[] = [];
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      catalog: { activeVariants: async () => variants },
      orders: memoryOrders().store,
      ai: { understand: async () => ({ intent: "other", items: [], message: "ok" }) },
      optOutOfFollowUps: async (contactId) => {
        optedOut.push(contactId);
      },
      log: { error() {} },
    });
    const reply = await product.handle(text("STOP"), ctx);
    expect(reply?.text).toContain("won't send you any more quote reminders");
    expect(optedOut).toEqual(["c1"]);
    expect(seen).toEqual([]);
    expect(orders).toEqual([]);

    // Without follow-ups, STOP goes to the AI like any other message.
    const off = setup({ intent: "other", items: [], message: "Okay." });
    await off.product.handle(text("STOP"), ctx);
    expect(off.seen).toHaveLength(1);
  });

  it("prices a request from the price list and saves the quote", async () => {
    const { product, orders, seen } = setup({
      intent: "quote",
      items: [
        { variantId: "v-flyer", quantity: 500 },
        { variantId: "v-card", quantity: 200 },
      ],
      message: null,
    });
    const reply = await product.handle(text("500 flyers and 200 cards"), ctx);

    expect(reply?.text).toContain("Here's your quote (KP-1001)");
    expect(reply?.text).toContain("500 x Flyers: A5, double-sided @ ₦100 = ₦50,000");
    expect(reply?.text).toContain("200 x Business cards: 350gsm matte @ ₦50 = ₦10,000");
    expect(reply?.text).toContain("*Total: ₦60,000*");
    expect(orders[0]?.totalKobo).toBe(6_000_000);
    // The AI only ever sees names and minimums, never prices.
    expect(JSON.stringify(seen[0]?.catalog)).not.toContain("15000");
  });

  it("explains a minimum instead of quoting below it", async () => {
    const { product, orders } = setup({ intent: "quote", items: [{ variantId: "v-card", quantity: 20 }], message: null });
    const reply = await product.handle(text("20 cards"), ctx);
    expect(reply?.text).toBe("Business cards: 350gsm matte: the minimum order is 100.");
    expect(orders).toHaveLength(0);
  });

  it("hands items with no set price to the owner instead of pricing them", async () => {
    const { product, orders } = setup({ intent: "quote", items: [{ variantId: "v-dtf", quantity: 20 }], message: null });
    const reply = await product.handle(text("20 A3 dtf"), ctx);
    expect(reply?.text).toBe("Thanks! The team will send you a price for: 20 x DTF transfers: A3.");
    expect(reply?.text).not.toContain("₦");
    expect(reply?.notify).toEqual([
      {
        to: "2348000000001",
        text: "Quote request from Ada (+2348012345678), please reply to them with a price:\n• 20 x DTF transfers: A3",
      },
    ]);
    expect(orders).toHaveLength(0);
  });

  it("quotes priced items and hands off the rest in the same reply", async () => {
    const { product, orders } = setup({
      intent: "quote",
      items: [
        { variantId: "v-flyer", quantity: 100 },
        { variantId: "v-dtf", quantity: 5 },
      ],
      message: null,
    });
    const reply = await product.handle(text("100 flyers and 5 dtf"), ctx);
    expect(reply?.text).toContain("*Total: ₦15,000*");
    expect(reply?.text).toContain("The team will send you a price for: 5 x DTF transfers: A3.");
    expect(reply?.notify?.[0]?.text).toContain("• 5 x DTF transfers: A3");
    expect(orders[0]?.lines).toHaveLength(1);
  });

  it("confirms the open quote, sends the invoice and alerts the owner", async () => {
    const quote = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await quote.product.handle(text("100 flyers"), ctx);

    const docs = fakeDocuments();
    const yes = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: "2348000000001",
      catalog: { activeVariants: async () => variants },
      orders: quote.store,
      ai: { understand: async () => ({ intent: "confirm", items: [], message: null }) },
      paymentDetails: "Bank 0000000000",
      renderDocument: docs.render,
    });
    const reply = await yes.handle(text("yes"), ctx);
    expect(reply?.text).toContain("Order KP-1001 is confirmed. Here's your invoice for ₦15,000.");
    expect(reply?.images).toEqual([{ data: new Uint8Array([0xff, 0xd8]), mimeType: "image/jpeg", caption: "Invoice KP-1001" }]);
    // The invoice carries the saved order's lines and total, not anything the AI said.
    expect(docs.drawn[0]).toMatchObject({
      kind: "invoice",
      ref: "KP-1001",
      customerName: "Ada",
      customerWaId: "2348012345678",
      totalKobo: 1_500_000,
      paymentDetails: "Bank 0000000000",
    });
    expect(docs.drawn[0]?.lines).toEqual(quote.orders[0]?.lines);
    expect(reply?.notify?.[0]?.to).toBe("2348000000001");
    expect(reply?.notify?.[0]?.text).toContain("New order KP-1001 from Ada (+2348012345678)");
    expect(reply?.notify?.[0]?.text).toContain("reply *paid KP-1001*");
    expect(quote.orders[0]?.status).toBe("confirmed");

    // A second YES finds nothing left to confirm and sends no alert.
    const again = await yes.handle(text("yes"), ctx);
    expect(again?.text).toContain("no quote waiting");
    expect(again?.notify).toBeUndefined();
  });

  it("puts a discount code's line on the owner alert and the invoice", async () => {
    const quote = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await quote.product.handle(text("100 flyers"), ctx);
    Object.assign(quote.orders[0]!, { totalKobo: 1_200_000, discount: { code: "XMAS", amountKobo: 300_000 } });

    const docs = fakeDocuments();
    const yes = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: quote.store,
      ai: { understand: async () => ({ intent: "confirm", items: [], message: null }) },
      renderDocument: docs.render,
    });
    const reply = await yes.handle(text("yes"), ctx);
    expect(reply?.text).toContain("Here's your invoice for ₦12,000");
    expect(reply?.notify?.[0]?.text).toContain("• Discount (XMAS) = -₦3,000\nTotal: ₦12,000");
    expect(docs.drawn[0]).toMatchObject({ discount: { code: "XMAS", amountKobo: 300_000 }, totalKobo: 1_200_000 });
  });

  it("still confirms in text when the invoice can't be drawn", async () => {
    const quote = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await quote.product.handle(text("100 flyers"), ctx);
    const yes = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      catalog: { activeVariants: async () => variants },
      orders: quote.store,
      ai: { understand: async () => ({ intent: "confirm", items: [], message: null }) },
      renderDocument: async () => {
        throw new Error("canvas broke");
      },
      log: { error() {} },
    });
    const reply = await yes.handle(text("yes"), ctx);
    expect(reply?.text).toContain("Order KP-1001 is confirmed (total ₦15,000)");
    expect(reply?.images).toBeUndefined();
  });

  it("cancels the open quote", async () => {
    const quote = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await quote.product.handle(text("100 flyers"), ctx);
    const no = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      catalog: { activeVariants: async () => variants },
      orders: quote.store,
      ai: { understand: async () => ({ intent: "cancel", items: [], message: null }) },
    });
    expect((await no.handle(text("no thanks"), ctx))?.text).toContain("cancelled quote KP-1001");
    expect(quote.orders[0]?.status).toBe("cancelled");
  });

  it("passes on the AI's question when the request is unclear", async () => {
    const { product } = setup({ intent: "other", items: [], message: "What size flyers do you need?" });
    expect((await product.handle(text("flyers"), ctx))?.text).toBe("What size flyers do you need?");
  });

  it("never forwards an AI reply that mentions money", async () => {
    const { product } = setup({ intent: "other", items: [], message: "Flyers are ₦120 each!" });
    const reply = await product.handle(text("how much are flyers"), ctx);
    expect(reply?.text).not.toContain("₦");
    expect(reply?.text).toContain("I can give you a quote for: Flyers, Business cards, DTF transfers");
  });

  it("falls back politely when the AI fails", async () => {
    const { product } = setup(new Error("timeout"));
    expect((await product.handle(text("do you open on sundays"), ctx))?.text).toContain("Sorry, I didn't catch that");
  });

  it("handles a transcribed voice note like a typed message", async () => {
    const { product, seen } = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    const reply = await product.handle({ ...text("100 flyers"), type: "audio", transcribed: true }, ctx);
    expect(reply?.text).toContain("*Total: ₦15,000*");
    expect(seen[0]?.text).toBe("100 flyers");
  });

  it("asks the customer to type when a voice note couldn't be understood", async () => {
    const { product, seen } = setup({ intent: "other", items: [], message: null });
    const reply = await product.handle({ ...text("x"), type: "audio", text: undefined }, ctx);
    expect(reply?.text).toContain("couldn't make out that voice note");
    expect(seen).toHaveLength(0);
  });

  it("asks for a message when sent a photo or other file", async () => {
    const { product } = setup({ intent: "other", items: [], message: null });
    const reply = await product.handle({ ...text("x"), type: "image", text: undefined }, ctx);
    expect(reply?.text).toContain("Please send your request as a message or voice note");
  });

  it("says so when the price list is empty", async () => {
    const { product } = setup({ intent: "other", items: [], message: null }, []);
    expect((await product.handle(text("hi"), ctx))?.text).toContain("price list isn't online yet");
  });
});

describe("owner: logo, invoices and receipts", () => {
  const fromOwner = (body: string): IncomingMessage => ({ ...text(body), from: OWNER, waMessageId: `wamid.owner.${body}` });
  const picture = (caption: string | undefined, mimeType = "image/png") => ({
    message: { ...fromOwner("pic"), type: "image", text: undefined, caption, mediaId: "media-1" } as IncomingMessage,
    ctx: { ...ctx, downloadMedia: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), mimeType }) },
  });

  async function confirmedOrder() {
    const s = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await s.product.handle(text("100 flyers"), ctx);
    s.orders[0]!.status = "confirmed";
    return s;
  }

  it("saves a picture captioned logo and puts it on documents", async () => {
    const s = await confirmedOrder();
    const p = picture("Logo");
    expect((await s.product.handle(p.message, p.ctx))?.text).toContain("Logo saved");
    expect(s.logos).toEqual([{ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }]);

    await s.product.handle(fromOwner("invoice KP-1001"), ctx);
    expect(s.drawn[0]?.logo).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a logo that isn't a picture, and hints when the caption is missing", async () => {
    const s = setup({ intent: "other", items: [], message: null });
    const pdf = picture("logo", "application/pdf");
    expect((await s.product.handle(pdf.message, pdf.ctx))?.text).toContain("send the logo as a picture");
    const bare = picture(undefined);
    expect((await s.product.handle(bare.message, bare.ctx))?.text).toContain("caption *logo*");
    expect(s.logos).toHaveLength(0);
  });

  it("marks an order paid and sends the customer a receipt, once", async () => {
    const s = await confirmedOrder();
    const reply = await s.product.handle(fromOwner("paid KP-1001"), ctx);
    expect(reply?.text).toContain("KP-1001 marked paid (₦15,000)");
    expect(reply?.images?.[0]?.caption).toBe("Receipt KP-1001");
    expect(reply?.notify).toEqual([
      {
        to: "2348012345678",
        text: "Payment received for order KP-1001 (₦15,000). Thank you for choosing KahnPrints! Here's your receipt:",
        images: [{ data: new Uint8Array([0xff, 0xd8]), mimeType: "image/jpeg", caption: "Receipt KP-1001" }],
      },
    ]);
    expect(s.orders[0]?.status).toBe("paid");
    expect(s.drawn[0]).toMatchObject({ kind: "receipt", totalKobo: 1_500_000 });

    // Saying it again doesn't send the customer a second receipt.
    const again = await s.product.handle(fromOwner("paid 1001"), ctx);
    expect(again?.text).toContain("already marked paid on 15 Oct 2026");
    expect(again?.notify).toBeUndefined();
    expect(s.seen).toHaveLength(1); // only the customer's quote went to the AI
  });

  it("understands the order number written different ways", async () => {
    const s = await confirmedOrder();
    for (const cmd of ["invoice KP-1001", "Invoice kp 1001", "invoice #1001", "invoice 1001."]) {
      expect((await s.product.handle(fromOwner(cmd), ctx))?.images?.[0]?.caption).toBe("Invoice KP-1001");
    }
  });

  it("won't mark a cancelled order paid, or give a receipt before payment", async () => {
    const s = await confirmedOrder();
    expect((await s.product.handle(fromOwner("receipt KP-1001"), ctx))?.text).toContain("isn't marked paid yet");
    s.orders[0]!.status = "cancelled";
    expect((await s.product.handle(fromOwner("paid KP-1001"), ctx))?.text).toContain("was cancelled");
    expect((await s.product.handle(fromOwner("paid KP-2000"), ctx))?.text).toContain("can't find order KP-2000");
  });

  it("only takes these commands from the owner", async () => {
    const s = await confirmedOrder();
    const reply = await s.product.handle(text("paid KP-1001"), ctx);
    expect(reply?.notify).toBeUndefined();
    expect(s.orders[0]?.status).toBe("confirmed");
    expect(s.seen).toHaveLength(2); // went to the AI like any customer message
  });

  it("explains the commands when the owner sends one on its own", async () => {
    const s = setup({ intent: "other", items: [], message: null });
    expect((await s.product.handle(fromOwner("receipt"), ctx))?.text).toContain("*paid KP-1001* marks an order paid");
  });

  it("lets the owner chat like a customer otherwise", async () => {
    const s = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    expect((await s.product.handle(fromOwner("100 flyers"), ctx))?.text).toContain("*Total: ₦15,000*");
  });
});

describe("welcome and menu", () => {
  it("greets with how to order and buttons, without asking the AI", async () => {
    const { product, seen } = setup(new Error("unused"));
    const reply = (await product.handle(text("Hi there!"), ctx))!;
    expect(seen).toHaveLength(0);
    expect(reply.text).toBe("");
    expect(reply.buttons?.body).toContain("Hi Ada! Welcome to KahnPrints.");
    expect(reply.buttons?.body).toContain("We offer: Flyers, Business cards, DTF transfers.");
    expect(reply.buttons?.body).toContain("e.g. *50 Flyers*. You can type it or send a voice note.");
    expect(reply.buttons?.body).toContain("4. You get your invoice here.");
    expect(reply.buttons?.body).not.toContain("pickup");
    expect(reply.buttons?.buttons.map((b) => b.title)).toEqual(["Get a quote", "Talk to someone"]);
    expect((await product.handle(text("menu"), ctx))?.buttons?.body).toContain("How to order:");
  });

  it("leaves greetings with a request in them to the AI", async () => {
    const { product, seen } = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    expect((await product.handle(text("hi, I need 100 flyers"), ctx))?.text).toContain("Here's your quote");
    expect(seen).toHaveLength(1);
  });

  it("answers the buttons", async () => {
    const { product } = setup(new Error("unused"));
    expect((await product.handle(text("get a quote"), ctx))?.text).toContain("I can give you a quote for: Flyers");
    const team = (await product.handle(text("talk to someone"), ctx))!;
    expect(team.text).toContain("let the KahnPrints team know");
    expect(team.notify?.[0]).toMatchObject({ to: OWNER, text: expect.stringContaining("Ada (+2348012345678) would like to talk to someone") });
  });

  it("shows only what the plan includes", async () => {
    const product = createQuoteProduct({
      businessName: "Mama Cakes",
      orderPrefix: "MC",
      catalog: { activeVariants: async () => variants },
      orders: memoryOrders().store,
      ai: { understand: async () => ({ intent: "other", items: [], message: "ok" }) },
      features: { planCode: async () => "free", has: async (f) => f === "catalogue", limit: async () => null },
      log: { error() {} },
    });
    const body = (await product.handle(text("good morning"), ctx))!.buttons!.body;
    expect(body).not.toContain("voice note");
    expect(body).not.toContain("invoice");
    expect((await product.handle(text("good morning"), ctx))!.buttons!.buttons).toHaveLength(1);
  });

  it("knows the words customers use for a menu or price list", () => {
    for (const ask of ["menu", "Menu?", "food menu", "Drinks menu pls", "can I see the menu", "send me your price list", "pricelist", "Rate card",
      "catalogue", "what do you sell?", "What's on the menu", "wetin una get", "abeg send una menu", "today's specials", "flavours", "wine list"]) {
      expect(welcomeAsk(ask), ask).toBe("catalogue");
    }
    for (const other of ["2 shawarma and a coke", "menu for a wedding of 200 guests", "how much is jollof rice", "list of 50 names"]) {
      expect(welcomeAsk(other), other).not.toBe("catalogue");
    }
    expect(welcomeAsk("help")).toBe("help");
  });

  it("sends the product cards for menu or price list, without asking the AI", async () => {
    const shown: number[] = [];
    const product = createQuoteProduct({
      businessName: "Grill House",
      orderPrefix: "GH",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: memoryOrders().store,
      ai: { understand: async () => { throw new Error("unused"); } },
      catalogue: {
        ownerCommand: async () => null,
        shortages: async () => new Map(),
        photos: async () => [],
        confirmed: async () => {},
        cards: async (_v, page) => (shown.push(page), { text: "Here's what we sell.", cards: [] }),
      },
      log: { error() {} },
    });
    expect((await product.handle(text("menu"), ctx))?.text).toBe("Here's what we sell.");
    expect((await product.handle(text("Price list please"), ctx))?.text).toBe("Here's what we sell.");
    expect(shown).toEqual([1, 1]);
    expect((await product.handle(text("hi"), ctx))?.buttons?.body).toContain("Send *menu* to see everything we sell");
    expect((await product.handle({ ...text("menu"), from: OWNER }, ctx))?.text).toContain("Your owner commands:");
  });

  it("shows the welcome for menu when product cards are off", async () => {
    const { product, seen } = setup(new Error("unused"));
    const body = (await product.handle(text("price list"), ctx))?.buttons?.body;
    expect(body).toContain("We offer: Flyers");
    expect(body).toContain("Send *help* any time to see this again.");
    expect(seen).toHaveLength(0);
  });

  it("gives the owner their commands on menu, and the customer view on hi", async () => {
    const { product } = setup(new Error("unused"));
    const menu = (await product.handle({ ...text("help"), from: OWNER }, ctx))!.text;
    expect(menu).toContain("Your owner commands:");
    expect(menu).toContain("*paid KP-1001*: marks an order paid and sends the customer a receipt");
    expect(menu).toContain("captioned *logo*");
    expect(menu).not.toContain("*orders*");
    expect(menu).not.toContain("*stock*");
    const hi = (await product.handle({ ...text("hello"), from: OWNER }, ctx))!;
    expect(hi.buttons?.body).toContain("You're the owner: send *menu* for your commands.");
  });
});

describe("safeMessage", () => {
  it("lets ordinary questions through", () => {
    expect(safeMessage("Which paper would you like, matte or gloss?")).toBe("Which paper would you like, matte or gloss?");
    expect(safeMessage("How many flyers do you need?")).toBe("How many flyers do you need?");
  });
  it("blocks anything that looks like an amount of money", () => {
    for (const m of ["That's ₦5,000", "about 5000 naira", "N5000", "it costs a bit", "total is 20k", "12,500 for all", "NGN 300"]) {
      expect(safeMessage(m)).toBeNull();
    }
  });
});

describe("quote product on a plan", () => {
  function onPlan(check: Awaited<ReturnType<PlanGate["checkOrder"]>>, credit: string | null = null) {
    const mem = memoryOrders();
    let intent: Understanding = { intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null };
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: mem.store,
      ai: { understand: async () => intent },
      renderDocument: fakeDocuments().render,
      plan: { credit: async () => credit, checkOrder: async () => check, summary: async () => "Your plan: *Free*" },
      log: { error() {} },
    });
    const say = (body: string, next: Understanding) => {
      intent = next;
      return product.handle(text(body), ctx);
    };
    return { product, say, ...mem };
  }
  const confirm: Understanding = { intent: "confirm", items: [], message: null };
  const quote: Understanding = { intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null };

  it("adds the yarnOga line to quotes and confirmations on the free plan", async () => {
    const { say } = onPlan({ allowed: true, warning: null }, "_Powered by yarnOga · yarnoga.com_");
    expect((await say("100 flyers", quote))?.text).toMatch(/Reply YES.*\n\n_Powered by yarnOga · yarnoga\.com_$/s);
    expect((await say("yes", confirm))?.text).toContain("Powered by yarnOga");
  });

  it("warns the owner on the last few free orders", async () => {
    const { say } = onPlan({ allowed: true, warning: "This is order 47 of 50 on your Free plan this month." });
    await say("100 flyers", quote);
    const reply = await say("yes", confirm);
    expect(reply?.text).toContain("is confirmed");
    expect(reply?.notify?.[0]?.text).toContain("order 47 of 50");
  });

  it("tells the owner about their bot messages, and lists them in the plan reply", async () => {
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: memoryOrders().store,
      ai: { understand: async () => quote },
      renderDocument: fakeDocuments().render,
      plan: {
        credit: async () => null,
        checkOrder: async () => ({ allowed: true, warning: null }),
        summary: async (usage = []) => ["Your plan: *Starter*", ...usage].join("\n"),
      },
      botMessages: {
        check: async () => "Heads-up: your WhatsApp number has sent 800 of the 1000 bot messages",
        summaryLine: async () => "Bot messages this month: 800 of 1000",
      },
      log: { error() {} },
    });
    const reply = await product.handle(text("100 flyers"), ctx);
    expect(reply?.notify).toEqual([{ to: OWNER, text: "Heads-up: your WhatsApp number has sent 800 of the 1000 bot messages" }]);
    const plan = await product.handle({ ...text("plan"), from: OWNER }, ctx);
    expect(plan?.text).toBe("Your plan: *Starter*\nBot messages this month: 800 of 1000");
  });

  it("hands the order to the owner instead of confirming it once the month's orders are used up", async () => {
    const { say, orders } = onPlan({ allowed: false, used: 50, limit: 50, planName: "Free" });
    await say("100 flyers", quote);
    const reply = await say("yes", confirm);
    expect(reply?.text).toBe("Thank you! The KahnPrints team will contact you shortly to complete order KP-1001 (total ₦15,000).");
    expect(reply?.images).toBeUndefined();
    expect(reply?.notify?.[0]?.to).toBe(OWNER);
    expect(reply?.notify?.[0]?.text).toContain("You've used all 50 orders on your Free plan this month");
    expect(reply?.notify?.[0]?.text).toContain("*paid KP-1001*");
    // Still open, so the owner can mark it paid by hand.
    expect(orders[0]?.status).toBe("quoted");
  });

  it("answers the owner's plan command", async () => {
    const { product } = onPlan({ allowed: true, warning: null });
    const reply = await product.handle({ ...text("plan"), from: OWNER }, ctx);
    expect(reply?.text).toBe("Your plan: *Free*");
  });

  it("passes the owner's upgrade request to the plan", async () => {
    const mem = memoryOrders();
    const asked: Array<[string, string]> = [];
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: mem.store,
      ai: { understand: async () => ({ intent: "other", items: [], message: null }) },
      plan: {
        credit: async () => null,
        checkOrder: async () => ({ allowed: true, warning: null }),
        summary: async () => "summary",
        upgrade: async (req, waId) => {
          asked.push([req, waId]);
          return "Here's your payment link";
        },
      },
    });
    expect((await product.handle({ ...text("upgrade to starter yearly"), from: OWNER }, ctx))?.text).toBe("Here's your payment link");
    expect(asked).toEqual([["starter yearly", OWNER]]);
    expect((await product.handle({ ...text("upgrade"), from: OWNER }, ctx))?.text).toBe("summary");
  });

  it("leaves customers who type plan to the AI", async () => {
    const { product } = onPlan({ allowed: true, warning: null });
    const reply = await product.handle(text("plan"), ctx);
    expect(reply?.text).toContain("Here's your quote");
  });
});

describe("quote product with plan features", () => {
  function withFeatures(opts: { useAi?: boolean; ownerNotice?: string | null; aiFails?: boolean; off?: string[] } = {}) {
    const mem = memoryOrders();
    const docs = fakeDocuments();
    let aiCalls = 0;
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: mem.store,
      ai: {
        understand: async () => {
          aiCalls++;
          if (opts.aiFails) throw new Error("AI down");
          return { intent: "quote", items: [{ variantId: "v-card", quantity: 100 }], message: null };
        },
      },
      renderDocument: docs.render,
      features: {
        planCode: async () => "free",
        has: async (f) => !(opts.off ?? []).includes(f),
        limit: async () => null,
      },
      credits: { spend: async () => ({ useAi: opts.useAi ?? true, ownerNotice: opts.ownerNotice ?? null }) },
      log: { error() {} },
    });
    return { product, drawn: docs.drawn, aiCalls: () => aiCalls, ...mem };
  }

  it("uses the AI while there are credits", async () => {
    const { product, aiCalls } = withFeatures();
    expect((await product.handle(text("100 cards"), ctx))?.text).toContain("Business cards");
    expect(aiCalls()).toBe(1);
  });

  it("keeps quoting with the menu once credits run out, and tells the owner", async () => {
    const { product, aiCalls } = withFeatures({ useAi: false, ownerNotice: "You've used all 300 AI replies" });
    const menu = await product.handle(text("hello, what do you sell?"), ctx);
    expect(menu?.text).toContain("1. Flyers: A5, double-sided");
    expect(menu?.text).toContain("*1 x 100*");
    expect(menu?.notify).toEqual([{ to: OWNER, text: "You've used all 300 AI replies" }]);

    const quote = await product.handle(text("1 x 100"), ctx);
    expect(quote?.text).toContain("100 x Flyers: A5, double-sided @ ₦150 = ₦15,000");
    expect(aiCalls()).toBe(0);
  });

  it("falls back to the menu when the AI is down", async () => {
    const { product } = withFeatures({ aiFails: true });
    expect((await product.handle(text("200 business cards"), ctx))?.text).toContain("200 x Business cards");
  });

  it("asks for typing when voice notes aren't on the plan", async () => {
    const { product } = withFeatures({ off: ["voice_notes"] });
    const reply = await product.handle({ ...text("100 cards"), type: "audio" }, ctx);
    expect(reply?.text).toContain("can't take voice notes");
  });

  it("sends the owner their orders page, or says which plans have it", async () => {
    const bot = (onPlan: boolean) =>
      createQuoteProduct({
        businessName: "KahnPrints",
        orderPrefix: "KP",
        ownerWaId: OWNER,
        catalog: { activeVariants: async () => variants },
        orders: memoryOrders().store,
        ai: { understand: async () => ({ intent: "other", items: [], message: "Hello!" }) },
        ordersLink: "https://bot.example.com/orders/abc",
        features: { planCode: async () => "pro", has: async () => onPlan, limit: async () => null },
      });
    expect((await bot(true).handle({ ...text("orders"), from: OWNER }, ctx))?.text).toContain("https://bot.example.com/orders/abc");
    expect((await bot(true).handle(text("orders"), ctx))?.text).toBe("Hello!");
    expect((await bot(false).handle({ ...text("Orders"), from: OWNER }, ctx))?.text).toContain("come with Pro and above");
  });

  it("confirms in text without an invoice picture when invoices aren't on the plan", async () => {
    const { product, drawn } = withFeatures({ off: ["invoices"] });
    await product.handle(text("100 cards"), ctx);
    const owner = await product.handle({ ...text("invoice KP-1001"), from: OWNER }, ctx);
    expect(owner?.text).toContain("aren't on your plan");
    expect(drawn).toHaveLength(0);
  });
});

describe("pay links", () => {
  async function confirmWithLink(payLink: (order: SavedOrder, waId: string) => Promise<string>) {
    const quote = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await quote.product.handle(text("100 flyers"), ctx);
    const docs = fakeDocuments();
    const bot = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: quote.store,
      ai: { understand: async () => ({ intent: "confirm", items: [], message: null }) },
      renderDocument: docs.render,
      payLink,
      log: { error() {} },
    });
    return { bot, reply: await bot.handle(text("yes"), ctx), orders: quote.orders, drawn: docs.drawn };
  }

  it("puts the pay link on the invoice for the order's saved total", async () => {
    const asked: Array<[number, number, string]> = [];
    const { reply } = await confirmWithLink(async (order, waId) => {
      asked.push([order.orderNumber, order.totalKobo, waId]);
      return "https://checkout.paystack.com/abc";
    });
    expect(asked).toEqual([[1001, 1_500_000, "2348012345678"]]);
    expect(reply?.images?.[0]?.caption).toBe("Invoice KP-1001\n\nPay online by card, bank transfer or USSD: https://checkout.paystack.com/abc");
    expect(reply?.notify?.[0]?.text).toContain("sent a link to pay online");
  });

  it("falls back to paying the business directly when Paystack is down", async () => {
    const { reply } = await confirmWithLink(async () => {
      throw new Error("down");
    });
    expect(reply?.images?.[0]?.caption).toBe("Invoice KP-1001");
    expect(reply?.notify?.[0]?.text).toContain("reply *paid KP-1001*");
  });

  it("marks the order paid once Paystack confirms, and sends the receipt", async () => {
    const { bot, orders, drawn } = await confirmWithLink(async () => "https://checkout.paystack.com/abc");
    const notes = await bot.orderPaid(1001);
    expect(orders[0]?.status).toBe("paid");
    expect(drawn.at(-1)).toMatchObject({ kind: "receipt", totalKobo: 1_500_000 });
    expect(notes[0]).toMatchObject({ to: "2348012345678", text: expect.stringContaining("Payment received for order KP-1001"), images: [{ caption: "Receipt KP-1001" }] });
    expect(notes[1]).toMatchObject({ to: OWNER, text: expect.stringContaining("KP-1001 paid online (₦15,000) by Ada") });
  });

  it("warns the owner instead of a second receipt when the order was already paid", async () => {
    const { bot, orders } = await confirmWithLink(async () => "https://checkout.paystack.com/abc");
    orders[0]!.status = "paid";
    const notes = await bot.orderPaid(1001);
    expect(notes).toEqual([{ to: OWNER, text: expect.stringContaining("already marked paid") }]);
    await expect(bot.orderPaid(2000)).rejects.toThrow("can't be found");
  });
});

describe("quote product with walk-in orders", () => {
  function walkInBot(opts: { delivery?: boolean } = {}) {
    const mem = memoryOrders();
    const walk = memoryWalkIn();
    walk.settings.walkIn = true;
    const docs = fakeDocuments();
    const deliveryAsked: string[] = [];
    // A delivery set-up that would ask for an address: walk-in orders must never reach it.
    const delivery = {
      handle: async () => null,
      beforeConfirm: async (order: SavedOrder) => {
        deliveryAsked.push(order.id);
        return { text: "Where should we deliver?" };
      },
      charge: async () => null,
      ownerNote: async () => null,
    } as unknown as Dispatch;
    const product = createQuoteProduct({
      businessName: "Element House",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: mem.store,
      ai: {
        understand: async ({ text }) =>
          /^yes$/i.test(text) ? { intent: "confirm", items: [], message: null } : { intent: "quote", items: [{ variantId: "v-card", quantity: 100 }], message: null },
      },
      ...(opts.delivery === false ? {} : { delivery }),
      renderDocument: docs.render,
      walkIn: createWalkIn({ businessId: BUSINESS, orderPrefix: "KP", store: walk.store, links }),
      log: { error() {} },
    });
    return { product, walk, drawn: docs.drawn, deliveryAsked };
  }

  it("skips delivery, gives the order a pickup code and tells the owner the table", async () => {
    const { product, walk, deliveryAsked } = walkInBot();
    expect((await product.handle(text("table 7"), ctx))?.text).toContain("you're at Table 7");
    await product.handle(text("100 business cards"), ctx);
    walk.addOrder("o1", 1001);
    const reply = await product.handle(text("YES"), ctx);
    expect(deliveryAsked).toEqual([]);
    expect(reply?.text).toContain("Please pay at the counter and give them your order number, KP-1001.");
    expect(reply?.notify?.[0]?.text).toContain("New walk-in order KP-1001 from Ada (+2348012345678) at Table 7:");
    expect(walk.orders.get("o1")?.pickupCode).toMatch(/^\d{4}$/);
  });

  it("puts the QR code on the receipt and the order on its screens once paid online", async () => {
    const { product, walk, drawn } = walkInBot();
    await product.handle(text("table 7"), ctx);
    await product.handle(text("100 business cards"), ctx);
    walk.addOrder("o1", 1001);
    await product.handle(text("YES"), ctx);

    const notes = await product.orderPaid(1001, { how: "online", feeKobo: 12_500 });
    const receipt = drawn.find((d) => d.kind === "receipt")!;
    expect(receipt.pickup).toMatchObject({ table: "Table 7", stations: ["Counter"] });
    expect(receipt.pickup!.qrText).toContain("https://bot.example.com/pickup/");
    expect(notes[0]?.text).toContain("We'll bring it to Table 7. Show the QR code on this receipt when you collect.");
    expect(notes[1]?.text).toContain("less the yarnOga fee (₦125) and Paystack's fee");
    expect(notes[1]?.text).toContain("It's on your pickup screen: Counter.");
    expect(walk.tickets).toHaveLength(1);
  });

  it("keeps delivering to customers who haven't checked in at the venue", async () => {
    const { product, walk, deliveryAsked } = walkInBot();
    walk.settings.paused = true;
    await product.handle(text("100 business cards"), ctx);
    expect((await product.handle(text("YES"), ctx))?.text).toBe("Where should we deliver?");
    expect(deliveryAsked).toEqual(["o1"]);
  });

  it("checks a customer in without a table, and treats every chat as walk-in when there's no delivery", async () => {
    const { product, walk } = walkInBot();
    expect((await product.handle(text("I'm here"), ctx))?.text).toContain("Welcome! Order here");
    await product.handle(text("100 business cards"), ctx);
    walk.addOrder("o1", 1001);
    const reply = await product.handle(text("YES"), ctx);
    expect(reply?.notify?.[0]?.text).toContain("New walk-in order KP-1001 from Ada (+2348012345678):");
    expect(walk.orders.get("o1")?.tableLabel).toBeNull();

    const noDelivery = walkInBot({ delivery: false });
    await noDelivery.product.handle(text("100 business cards"), ctx);
    noDelivery.walk.addOrder("o1", 1001);
    expect((await noDelivery.product.handle(text("YES"), ctx))?.text).toContain("Please pay at the counter");
  });

  it("says so when the owner has closed orders at the venue", async () => {
    const { product, walk } = walkInBot();
    walk.settings.paused = true;
    await product.handle(text("table 7"), ctx);
    expect((await product.handle(text("100 business cards"), ctx))?.text).toBe(
      "Sorry, Element House isn't taking new orders right now. Please ask a member of staff.",
    );
  });

  it("tells the owner an order was paid at the counter", async () => {
    const { product, walk } = walkInBot();
    await product.handle(text("I'm here"), ctx);
    await product.handle(text("100 business cards"), ctx);
    walk.addOrder("o1", 1001);
    await product.handle(text("YES"), ctx);
    const notes = await product.orderPaid(1001, { how: "counter" });
    expect(notes[1]?.text).toContain("KP-1001 was paid at the counter");
    expect(await product.orderPaid(1001, { how: "counter" })).toEqual([]);
  });
});

describe("French and CFA francs", () => {
  const cfa: Variant[] = [
    { id: "v-pagne", name: "Pagne: 6 yards", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 1_250_000 }] },
  ];
  function frenchBot(answer: Understanding) {
    const mem = memoryOrders();
    const seen: Array<Parameters<Understander["understand"]>[0]> = [];
    const docs = fakeDocuments();
    const product = createQuoteProduct({
      businessName: "Chez Awa",
      orderPrefix: "CA",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => cfa },
      orders: mem.store,
      ai: {
        async understand(input) {
          seen.push(input);
          return answer;
        },
      },
      branding: memoryBranding().branding,
      renderDocument: docs.render,
      language: "fr",
      currency: "XOF",
      log: { error() {} },
    });
    return { product, seen, drawn: docs.drawn, ...mem };
  }

  it("quotes a French customer in French, priced in FCFA from the price list", async () => {
    const { product, seen, orders } = frenchBot({ intent: "quote", items: [{ variantId: "v-pagne", quantity: 2 }], message: null, language: "fr" });
    const reply = await product.handle(text("Je voudrais 2 pagnes s'il vous plaît"), ctx);
    expect(reply?.text).toContain("Voici votre devis (CA-1001)");
    expect(reply?.text).toMatch(/25\s000\sFCFA/);
    expect(reply?.text).toContain("Répondez OUI");
    expect(orders[0]?.totalKobo).toBe(2_500_000);
    expect(seen[0]?.language).toBe("fr");
  });

  it("answers an English customer of a French business in English", async () => {
    const { product } = frenchBot({ intent: "quote", items: [{ variantId: "v-pagne", quantity: 1 }], message: null, language: "en" });
    const reply = await product.handle(text("Hello, I need 1 pagne please"), ctx);
    expect(reply?.text).toContain("Here's your quote (CA-1001)");
    expect(reply?.text).toMatch(/12\s500\sFCFA/);
  });

  it("greets in French and keeps a model-written price out of the reply", async () => {
    const hi = frenchBot({ intent: "other", items: [], message: "Bonjour !", language: "fr" });
    const reply = await hi.product.handle(text("Bonjour"), ctx);
    expect(reply?.buttons?.body ?? reply?.text).toContain("Bienvenue chez Chez Awa");

    const sneaky = frenchBot({ intent: "other", items: [], message: "Le pagne coûte 5 000 FCFA.", language: "fr" });
    const answer = await sneaky.product.handle(text("C'est combien le pagne ?"), ctx);
    expect(answer?.text ?? "").not.toContain("5 000");
  });
});

describe("Pidgin", () => {
  it("answers a Pidgin customer in Pidgin, with the price from the price list", async () => {
    const { product, seen, orders } = setup({ intent: "quote", items: [{ variantId: "v-card", quantity: 200 }], message: null, language: "pcm" });
    const reply = await product.handle(text("Abeg how much for 200 business card?"), ctx);
    expect(seen[0]?.language).toBe("pcm");
    expect(reply?.text).toContain("See your quote (KP-1001)");
    expect(reply?.text).toContain("₦10,000");
    expect(reply?.text).toContain("Reply YES make I place this order");
    expect(orders[0]?.totalKobo).toBe(1_000_000);
  });

  it("welcomes a Pidgin greeting in Pidgin", async () => {
    const { product } = setup({ intent: "other", items: [], message: null });
    const hi = await product.handle(text("how far"), ctx);
    expect(hi?.buttons?.body).toContain("You don land KahnPrints");
    expect(hi?.buttons?.buttons.map((b) => b.title)).toEqual(["Get quote", "Talk to person"]);
  });
});

describe("payment reminders", () => {
  it("reminds about a confirmed order with its total and how to pay, and not once it's paid", async () => {
    const { product, orders } = setup({ intent: "quote", items: [{ variantId: "v-card", quantity: 200 }], message: null });
    await product.handle(text("200 cards"), ctx);
    orders[0]!.status = "confirmed";
    const first = await product.paymentReminder(1001, 1);
    expect(first).toContain("your order KP-1001 (₦10,000) is waiting for payment");
    expect(first).toContain("Bank 0000000000");
    expect(await product.paymentReminder(1001, 2)).toContain("last reminder");
    orders[0]!.status = "paid";
    expect(await product.paymentReminder(1001, 2)).toBeNull();
  });
});

describe("about and opening hours", () => {
  it("passes the About section to the AI and says when the shop is closed", async () => {
    const seen: Array<{ about?: string | null }> = [];
    const nearlyNever = { mon: ["00:00", "00:01"], tue: ["00:00", "00:01"], wed: ["00:00", "00:01"], thu: ["00:00", "00:01"], fri: ["00:00", "00:01"], sat: ["00:00", "00:01"], sun: ["00:00", "00:01"] } as const;
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: memoryOrders().store,
      ai: { understand: async (input) => (seen.push(input), { intent: "other", items: [], message: "We're opposite the filling station." }) },
      about: async () => ({ text: "Opposite the filling station.", hours: { ...nearlyNever } as never }),
      log: { error() {} },
    });
    await product.handle(text("where are you located?"), ctx);
    expect(seen[0]?.about).toContain("Opposite the filling station.");
    const hi = await product.handle(text("hi"), ctx);
    expect(hi?.buttons?.body).toContain("We're closed right now and open again");
  });
});

describe("ratings", () => {
  it("asks with three buttons, saves a tap without the AI, and tells the owner about a bad one", async () => {
    const saved: Array<[number, string, number]> = [];
    const seen: unknown[] = [];
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: memoryOrders().store,
      ai: { understand: async (i) => (seen.push(i), { intent: "other", items: [], message: "?" }) },
      saveRating: async (n, waId, stars) => (saved.push([n, waId, stars]), saved.length === 1),
      log: { error() {} },
    });
    const ask = product.ratingAsk(1001);
    expect(ask.buttons.body).toContain("How did we do with your order KP-1001?");
    expect(ask.buttons.buttons.map((b) => b.id)).toEqual(["rate KP-1001 5", "rate KP-1001 3", "rate KP-1001 1"]);

    const bad = await product.handle(text("rate KP-1001 1"), ctx);
    expect(bad?.text).toContain("sorry it wasn't right");
    expect(bad?.notify?.[0]).toMatchObject({ to: OWNER, text: expect.stringContaining("*not good*") });
    expect(saved[0]).toEqual([1001, "2348012345678", 1]);
    expect((await product.handle(text("rate KP-1001 5"), ctx))?.text).toContain("already have your answer");
    expect(seen).toEqual([]);
  });
});

describe("order again", () => {
  it("offers the last order on hi, and quotes it again at today's prices", async () => {
    const mem = memoryOrders();
    const last = {
      id: "old", orderNumber: 900, totalKobo: 999,
      lines: [
        { variantId: "v-flyer", name: "Flyers: A5, double-sided", quantity: 500, unitPriceKobo: 1, totalKobo: 500 },
        { variantId: "v-gone", name: "Old stickers", quantity: 10, unitPriceKobo: 1, totalKobo: 10 },
      ],
    };
    const seen: unknown[] = [];
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: { ...mem.store, lastOrder: async () => last },
      ai: { understand: async (i) => (seen.push(i), { intent: "other", items: [], message: "?" }) },
      log: { error() {} },
    });
    const hi = await product.handle(text("hi"), ctx);
    expect(hi?.buttons?.body).toContain("Last time you ordered: 500 x Flyers: A5, double-sided");
    expect(hi?.buttons?.buttons.at(-1)).toEqual({ id: "order again", title: "🔁 Order again" });

    const again = await product.handle(text("order again"), ctx);
    expect(again?.text).toContain("isn't on the price list any more (Old stickers)");
    expect(again?.text).toContain("500 x Flyers: A5, double-sided @ ₦100 = ₦50,000");
    expect(mem.orders.at(-1)?.totalKobo).toBe(5_000_000);
    expect(seen).toEqual([]);
  });

  it("is left out on a plan without it (Free)", async () => {
    const mem = memoryOrders();
    const last = { id: "old", orderNumber: 900, totalKobo: 1, lines: [{ variantId: "v-flyer", name: "Flyers", quantity: 500, unitPriceKobo: 1, totalKobo: 500 }] };
    const product = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: OWNER,
      catalog: { activeVariants: async () => variants },
      orders: { ...mem.store, lastOrder: async () => last },
      features: { planCode: async () => "free", has: async (f) => f !== "order_again", limit: async () => null },
      ai: { understand: async () => ({ intent: "other", items: [], message: "How can I help?" }) },
      log: { error() {} },
    });
    const hi = await product.handle(text("hi"), ctx);
    expect(hi?.buttons?.buttons.some((x) => x.id === "order again")).toBe(false);
    await product.handle(text("order again"), ctx);
    expect(mem.orders).toEqual([]);
  });
});
