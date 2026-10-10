import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createQuoteProduct, safeMessage } from "./index.js";
import type { QuoteLine, Variant } from "./pricing.js";
import type { CatalogStore, OrderStore, SavedOrder } from "./store.js";
import type { Understander, Understanding } from "./understand.js";

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
  const orders: Array<SavedOrder & { contactId: string; status: string }> = [];
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
  };
  return { store, orders };
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
  const product = createQuoteProduct({
    businessName: "KahnPrints",
    orderPrefix: "KP",
    ownerWaId: "2348000000001",
    catalog: catalogStore,
    orders: mem.store,
    ai,
    log: { error() {} },
  });
  return { product, seen, ...mem };
}

function text(body: string): IncomingMessage {
  return { waMessageId: `wamid.${body}`, from: "2348012345678", contactName: "Ada", type: "text", text: body, timestamp: 1, raw: {} };
}
const ctx = {
  contactId: "c1",
  history: [],
  downloadMedia: async () => ({ data: new Blob([]), mimeType: "image/jpeg" }),
};

describe("quote product", () => {
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

  it("confirms the open quote and alerts the owner", async () => {
    const quote = setup({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null });
    await quote.product.handle(text("100 flyers"), ctx);

    const yes = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: "2348000000001",
      catalog: { activeVariants: async () => variants },
      orders: quote.store,
      ai: { understand: async () => ({ intent: "confirm", items: [], message: null }) },
    });
    const reply = await yes.handle(text("yes"), ctx);
    expect(reply?.text).toContain("Order KP-1001 is confirmed (total ₦15,000)");
    expect(reply?.notify?.[0]?.to).toBe("2348000000001");
    expect(reply?.notify?.[0]?.text).toContain("New order KP-1001 from Ada (+2348012345678)");
    expect(quote.orders[0]?.status).toBe("confirmed");

    // A second YES finds nothing left to confirm and sends no alert.
    const again = await yes.handle(text("yes"), ctx);
    expect(again?.text).toContain("no quote waiting");
    expect(again?.notify).toBeUndefined();
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
