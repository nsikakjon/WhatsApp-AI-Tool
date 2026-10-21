import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createQuoteProduct, safeMessage } from "./index.js";
import type { QuoteLine, Variant } from "./pricing.js";
import type { BrandingStore, CatalogStore, OrderStore, SavedOrder } from "./store.js";
import type { DocumentInput } from "./documents.js";
import type { Understander, Understanding } from "./understand.js";
import type { PlanGate } from "./plan.js";

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
    expect((await product.handle(text("hi"), ctx))?.text).toContain("Sorry, I didn't catch that");
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

  it("confirms in text without an invoice picture when invoices aren't on the plan", async () => {
    const { product, drawn } = withFeatures({ off: ["invoices"] });
    await product.handle(text("100 cards"), ctx);
    const owner = await product.handle({ ...text("invoice KP-1001"), from: OWNER }, ctx);
    expect(owner?.text).toContain("aren't on your plan");
    expect(drawn).toHaveLength(0);
  });
});
