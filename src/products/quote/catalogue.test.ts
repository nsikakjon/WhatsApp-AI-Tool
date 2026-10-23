import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createCatalogue, createSupabaseCatalogue, type CatalogueItem, type CatalogueStore } from "./catalogue.js";
import { createQuoteProduct } from "./index.js";
import type { SavedOrder } from "./store.js";

const OWNER = "2348011111111";
const CUSTOMER = "2348022222222";

function memory(items: CatalogueItem[]) {
  const photos = new Map<string, Uint8Array>();
  const taken: string[] = [];
  const store: CatalogueStore = {
    items: async () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    setStock: async (id, stock) => void (items.find((i) => i.variantId === id)!.stock = stock),
    savePhoto: async (productId, data) => {
      photos.set(`p/${productId}`, data);
      for (const i of items) if (i.productId === productId) i.photoPath = `p/${productId}`;
    },
    photo: async (path) => (photos.has(path) ? { data: photos.get(path)!, mimeType: "image/jpeg" } : null),
    takeStock: async (orderId) => void taken.push(orderId),
  };
  return { store, photos, taken };
}

const items = (): CatalogueItem[] => [
  { variantId: "v-large", name: "T-shirts: Large", productId: "p-shirt", productName: "T-shirts", productDescription: null, stock: 5, photoPath: null },
  { variantId: "v-mug", name: "Mugs: White", productId: "p-mug", productName: "Mugs", productDescription: "11oz ceramic, printed with your logo.", stock: null, photoPath: null },
];

let n = 0;
const msg = (from: string, text: string, extra: Partial<IncomingMessage> = {}): IncomingMessage => ({
  waMessageId: `wamid.${++n}`,
  from,
  type: "text",
  text,
  timestamp: 1,
  raw: {},
  ...extra,
});
const ctx: ProductContext = {
  contactId: "c1",
  history: [],
  downloadMedia: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), mimeType: "image/jpeg" }),
  sendLater: async () => {},
  canMessageFreely: async () => true,
};

function bot(opts: { onPlan?: boolean; quantity?: number } = {}) {
  const mem = memory(items());
  const orders: Array<SavedOrder & { status: string }> = [];
  const catalogue = createCatalogue({
    store: mem.store,
    features: { planCode: async () => "pro", has: async () => opts.onPlan ?? true, limit: async () => null },
  });
  const product = createQuoteProduct({
    businessName: "Demo Shop",
    orderPrefix: "DEMO",
    ownerWaId: OWNER,
    catalog: {
      activeVariants: async () => [
        { id: "v-large", name: "T-shirts: Large", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 500_000 }] },
        { id: "v-mug", name: "Mugs: White", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 300_000 }] },
      ],
    },
    orders: {
      createQuote: async (_c, lines, totalKobo) => {
        const o = { id: `o${orders.length + 1}`, orderNumber: 1001 + orders.length, totalKobo, lines, status: "quoted" };
        orders.push(o);
        return o;
      },
      latestOpenQuote: async () => orders.find((o) => o.status === "quoted") ?? null,
      setStatus: async (id, status) => {
        const o = orders.find((x) => x.id === id && x.status === "quoted");
        if (o) o.status = status;
        return Boolean(o);
      },
      findOrder: async () => null,
      markPaid: async () => false,
    },
    ai: {
      understand: async ({ text }) =>
        /^yes$/i.test(text)
          ? { intent: "confirm", items: [], message: null }
          : /catalogue$|mugs\?/i.test(text)
          ? { intent: "catalogue", items: [], show: /mugs/i.test(text) ? ["v-mug"] : [], message: "We sell T-shirts and mugs." }
          : {
              intent: "quote",
              items: [
                { variantId: "v-large", quantity: opts.quantity ?? 2 },
                { variantId: "v-mug", quantity: 10 },
              ],
              message: null,
            },
    },
    catalogue,
    renderDocument: async () => new Uint8Array([0xff]),
    features: { planCode: async () => "pro", has: async (f) => f !== "invoices" && (f !== "catalogue" || (opts.onPlan ?? true)), limit: async () => null },
  });
  return { product, orders, ...mem };
}

describe("stock", () => {
  it("lets the owner list and set stock by number", async () => {
    const { product } = bot();
    const list = await product.handle(msg(OWNER, "stock"), ctx);
    expect(list?.text).toContain("1. Mugs: White: not counted");
    expect(list?.text).toContain("2. T-shirts: Large: 5 left");
    expect((await product.handle(msg(OWNER, "stock 1 40"), ctx))?.text).toBe("Mugs: White: 40 left.");
    expect((await product.handle(msg(OWNER, "stock 2 off"), ctx))?.text).toBe("T-shirts: Large: no longer counted.");
    expect((await product.handle(msg(OWNER, "stock shirt"), ctx))?.text).toContain("2. T-shirts: Large: not counted");
    expect((await product.handle(msg(OWNER, "stock 9 1"), ctx))?.text).toContain("There's no item 9");
  });

  it("won't quote more than is left, and takes a confirmed order off the stock", async () => {
    const { product, taken } = bot({ quantity: 8 });
    const quote = await product.handle(msg(CUSTOMER, "8 large shirts and 10 mugs"), ctx);
    expect(quote?.text).toContain("10 x Mugs: White");
    expect(quote?.text).not.toContain("8 x T-shirts");
    expect(quote?.text).toContain("T-shirts: Large: only 5 left.");
    await product.handle(msg(CUSTOMER, "yes"), ctx);
    expect(taken).toEqual(["o1"]);
  });

  it("ignores stock on a plan without it", async () => {
    const { product, taken } = bot({ quantity: 8, onPlan: false });
    expect((await product.handle(msg(CUSTOMER, "8 large shirts"), ctx))?.text).toContain("8 x T-shirts: Large");
    expect((await product.handle(msg(OWNER, "stock"), ctx))?.text).toContain("come with Pro and above");
    await product.handle(msg(CUSTOMER, "yes"), ctx);
    expect(taken).toHaveLength(0);
  });
});

describe("product photos", () => {
  it("saves the owner's photo and sends it with quotes", async () => {
    const { product } = bot();
    const photo = { type: "image" as const, mediaId: "m1", text: undefined };
    expect((await product.handle(msg(OWNER, "", { ...photo, caption: "photo shirts" }), ctx))?.text).toBe(
      "Photo saved for T-shirts ✅ Customers will see it with their quotes.",
    );
    expect((await product.handle(msg(OWNER, "", { ...photo, caption: "photo bags" }), ctx))?.text).toContain("one of: Mugs, T-shirts");

    const quote = await product.handle(msg(CUSTOMER, "2 shirts and 10 mugs"), ctx);
    expect(quote?.images).toEqual([{ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", caption: "T-shirts" }]);
  });
});

describe("product cards", () => {
  it("answers a catalogue request with a card per product, priced from the price list", async () => {
    const { product } = bot();
    await product.handle(msg(OWNER, "", { type: "image", mediaId: "m1", text: undefined, caption: "photo mugs" }), ctx);
    const reply = await product.handle(msg(CUSTOMER, "Can I see your catalogue"), ctx);
    expect(reply?.text).toContain("Tap *Order this*");
    expect(reply?.cards).toEqual([
      {
        image: { data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
        body: "*Mugs*\n• White: ₦3,000 each\n\n11oz ceramic, printed with your logo.",
        buttons: [{ id: "I'd like Mugs", title: "Order this" }],
      },
      { body: "*T-shirts*\n• Large: ₦5,000 each", buttons: [{ id: "I'd like T-shirts", title: "Order this" }] },
    ]);
    expect(reply?.buttons).toBeUndefined();
  });

  it("shows just the product asked about", async () => {
    const { product } = bot();
    const reply = await product.handle(msg(CUSTOMER, "how much are your mugs?"), ctx);
    expect(reply?.cards?.map((c) => c.body.split("\n")[0])).toEqual(["*Mugs*"]);
  });

  it("sends cards without photos on a plan without them", async () => {
    const { product } = bot({ onPlan: false });
    const reply = await product.handle(msg(CUSTOMER, "catalogue"), ctx);
    expect(reply?.cards?.every((c) => !c.image)).toBe(true);
  });

  it("pages five products at a time, with bulk prices, minimums and unpriced items", async () => {
    const many: CatalogueItem[] = Array.from({ length: 7 }, (_, i) => ({
      variantId: `v${i}`,
      name: `Item ${i}: Standard`,
      productId: `p${i}`,
      productName: `Item ${i}`,
      productDescription: null,
      stock: null,
      photoPath: null,
    }));
    const variants = [
      { id: "v0", name: "Item 0: Standard", minQuantity: 10, tiers: [{ minQuantity: 10, unitPriceKobo: 500_000 }, { minQuantity: 50, unitPriceKobo: 420_000 }] },
      { id: "v1", name: "Item 1: Standard", minQuantity: 1, tiers: [] },
    ];
    const catalogue = createCatalogue({ store: memory(many).store });

    const first = await catalogue.cards(variants, 1);
    expect(first?.cards).toHaveLength(5);
    expect(first?.cards?.[0]?.body).toBe("*Item 0*\n• Standard: ₦5,000 each, ₦4,200 each from 50 (min. 10)");
    expect(first?.cards?.[1]?.body).toBe("*Item 1*\n• Standard: price on request");
    expect(first?.buttons).toEqual({ body: "That's 5 of 7 products.", buttons: [{ id: "catalogue page 2", title: "See more" }] });

    const second = await catalogue.cards(variants, 2);
    expect(second?.text).toBe("");
    expect(second?.cards?.map((c) => c.body.split("\n")[0])).toEqual(["*Item 5*", "*Item 6*"]);
    expect(second?.buttons).toBeUndefined();
  });

  it("sends the next page when the customer taps See more, without the AI", async () => {
    const { product } = bot();
    const reply = await product.handle(msg(CUSTOMER, "catalogue page 1"), ctx);
    expect(reply?.cards).toHaveLength(2);
  });
});

describe("sample photos by web address", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downloads a photo saved as an https address instead of from storage", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    });
    const store = createSupabaseCatalogue({} as SupabaseClient, "b2");
    const photo = await store.photo("https://images.pexels.com/photos/1/pexels-photo-1.jpeg");
    expect(fetched).toEqual(["https://images.pexels.com/photos/1/pexels-photo-1.jpeg"]);
    expect(photo).toEqual({ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" });
  });
});
