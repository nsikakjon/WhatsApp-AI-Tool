import { describe, expect, it } from "vitest";
import { formatMoney } from "../../core/money.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createQuoteProduct } from "./index.js";
import { createShopLinks, createShopPage, slugify, type ShopBusiness, type ShopProduct, type SlugStore } from "./shop.js";
import type { OrderStore } from "./store.js";

const BIZ = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";
const FLYER = "11111111-1111-1111-1111-111111111111";

function memorySlugs(taken: Record<string, string> = {}): SlugStore & { rows: Record<string, string> } {
  const rows: Record<string, string> = { ...taken };
  return {
    rows,
    async slugOf(id) {
      return Object.keys(rows).find((s) => rows[s] === id) ?? null;
    },
    async bySlug(slug) {
      return rows[slug] ?? null;
    },
    async setSlug(id, slug) {
      if (rows[slug] && rows[slug] !== id) return false;
      for (const s of Object.keys(rows)) if (rows[s] === id) delete rows[s];
      rows[slug] = id;
      return true;
    },
  };
}

const products: ShopProduct[] = [
  {
    id: FLYER,
    name: "Flyers",
    description: "Full colour, 150gsm gloss.",
    category: "Print",
    photoPath: `businesses/${BIZ}/products/${FLYER}`,
    leadTimeDays: 2,
    options: [
      {
        label: "A5, double-sided",
        stock: null,
        variant: {
          id: "v1",
          name: "Flyers: A5, double-sided",
          minQuantity: 50,
          tiers: [
            { minQuantity: 50, unitPriceKobo: 15_000 },
            { minQuantity: 500, unitPriceKobo: 10_000 },
          ],
        },
      },
      { label: "A4", stock: 0, variant: { id: "v2", name: "Flyers: A4", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 30_000 }] } },
    ],
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Mugs <special>",
    description: null,
    category: null,
    photoPath: null,
    leadTimeDays: null,
    options: [{ label: "White", stock: 3, variant: { id: "v3", name: "Mugs <special>: White", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 450_000 }] } }],
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Banners",
    description: null,
    category: "Print",
    photoPath: null,
    leadTimeDays: null,
    options: [{ label: "Roll-up", stock: 0, variant: { id: "v4", name: "Banners: Roll-up", minQuantity: 1, tiers: [] } }],
  },
];

function business(over: Partial<ShopBusiness> = {}): ShopBusiness {
  return {
    id: BIZ,
    name: "Ada's Prints",
    whatsappNumber: "2348011112222",
    currency: "NGN",
    lang: "en",
    photos: async () => true,
    products: async () => products,
    photo: async (path) => (path.endsWith(FLYER) ? { data: new Uint8Array([0xff, 0xd8, 1]), mimeType: "image/jpeg" } : null),
    logo: async () => null,
    ...over,
  };
}

function pageApp(b: ShopBusiness | null = business()) {
  return createShopPage({
    slugs: memorySlugs({ "adas-prints": BIZ }),
    business: async (id) => (b && id === b.id ? b : null),
    publicUrl: "https://app.yarnoga.com/",
    log: { error() {} },
  });
}

const msg = (text: string): IncomingMessage => ({ waMessageId: `w-${text}`, from: "2348099990000", type: "text", text, timestamp: new Date() }) as IncomingMessage;

describe("shop names", () => {
  it("makes a link-safe name from the business name", () => {
    expect(slugify("Ada's Prints")).toBe("adas-prints");
    expect(slugify("Chops & Grills, Lekki!")).toBe("chops-and-grills-lekki");
    expect(slugify("Café Réné")).toBe("cafe-rene");
    expect(slugify("Jo")).toBe("jo-shop");
    expect(slugify("***")).toBe("my-shop");
    expect(slugify("a".repeat(60)).length).toBe(40);
  });

  it("gives each business its own name, numbering a taken one, and keeps it", async () => {
    const slugs = memorySlugs({ "adas-prints": OTHER });
    const links = createShopLinks({ publicUrl: "https://app.yarnoga.com", slugs });
    expect(await links.link(BIZ, "Ada's Prints")).toBe("https://app.yarnoga.com/shop/adas-prints-2");
    expect(await links.link(BIZ, "Renamed Business")).toBe("https://app.yarnoga.com/shop/adas-prints-2");
  });

  it("lets the owner change the name, unless it's taken or not link-safe", async () => {
    const slugs = memorySlugs({ "mama-put": OTHER });
    const links = createShopLinks({ publicUrl: "https://app.yarnoga.com", slugs });
    expect(await links.rename(BIZ, "mama-put")).toEqual({ ok: false, reason: "taken" });
    expect(await links.rename(BIZ, "a")).toEqual({ ok: false, reason: "format" });
    expect(await links.rename(BIZ, "bad--name")).toEqual({ ok: false, reason: "format" });
    expect(await links.rename(BIZ, "Ada Prints Ikeja")).toEqual({ ok: true, link: "https://app.yarnoga.com/shop/ada-prints-ikeja" });
    expect(await slugs.bySlug("ada-prints-ikeja")).toBe(BIZ);
  });
});

describe("owner shop commands", () => {
  const owner = (hasNumber: boolean) => ({ id: BIZ, name: "Ada's Prints", lang: "en" as const, hasNumber: async () => hasNumber });

  it("sends the link, and warns when customers' number isn't saved yet", async () => {
    const links = createShopLinks({ publicUrl: "https://app.yarnoga.com", slugs: memorySlugs() });
    const reply = await links.ownerCommand(owner(true), msg("shop"));
    expect(reply).toContain("Your shop: https://app.yarnoga.com/shop/adas-prints");
    expect(reply).not.toContain("stays closed");
    expect(await links.ownerCommand(owner(false), msg("my shop link"))).toContain("Until then the shop stays closed");
    expect(await links.ownerCommand(owner(true), msg("shopping list"))).toBeNull();
  });

  it("changes the link name", async () => {
    const links = createShopLinks({ publicUrl: "https://app.yarnoga.com", slugs: memorySlugs({ taken: OTHER }) });
    expect(await links.ownerCommand(owner(true), msg("shop link ada-ikeja"))).toContain("https://app.yarnoga.com/shop/ada-ikeja");
    expect(await links.ownerCommand(owner(true), msg("shop link taken"))).toContain("already has that name");
  });

  it("is one of the quote bot's owner commands", async () => {
    const links = createShopLinks({ publicUrl: "https://app.yarnoga.com", slugs: memorySlugs() });
    const bot = createQuoteProduct({
      businessName: "Ada's Prints",
      orderPrefix: "AP",
      ownerWaId: "2348099990000",
      catalog: { activeVariants: async () => [] },
      orders: {} as OrderStore,
      ai: { understand: async () => ({ intent: "other", items: [], message: null }) },
      shop: { ownerCommand: (m) => links.ownerCommand(owner(true), m) },
      log: { error() {} },
    });
    const ctx = { contactId: "c1", history: [], downloadMedia: async () => ({ data: new Blob(), mimeType: "image/jpeg" }) };
    expect((await bot.handle(msg("shop"), ctx))?.text).toContain("/shop/adas-prints");
    expect((await bot.handle(msg("menu"), ctx))?.text).toContain("*shop*: your shop link");
  });
});

describe("shop page", () => {
  it("lists products with prices from the price list, grouped by category", async () => {
    const res = await pageApp().request("/shop/adas-prints");
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Ada&#39;s Prints</h1>");
    expect(page).toContain("₦150 each, ₦100 each from 500 (min. 50)");
    expect(page).toContain("Ready in 2 working days");
    expect(page.indexOf("<h2>Print</h2>")).toBeLessThan(page.indexOf("<h2>More</h2>"));
    // Names are escaped, never put on the page as HTML.
    expect(page).toContain("Mugs &lt;special&gt;");
    expect(page).not.toContain("<special>");
    expect(page).toContain("3 left");
    expect(page).toContain("Price on request");
  });

  it("opens WhatsApp on the business's number with the order typed", async () => {
    const page = await (await pageApp().request("/shop/adas-prints")).text();
    // The page escapes ' as &#39;, which the browser turns back.
    expect(page).toContain("https://wa.me/2348011112222?text=I&#39;d%20like%20Flyers");
    expect(page).toContain('data-name="Flyers: A5, double-sided" data-min="50"');
    expect(page).toContain(JSON.stringify("Hello Ada's Prints, I'd like to order:"));
  });

  it("shows sold-out options without a quantity box, and no order button when everything is sold out", async () => {
    const page = await (await pageApp().request("/shop/adas-prints")).text();
    expect(page).toContain("Sold out");
    expect(page).not.toContain('data-name="Flyers: A4"');
    expect(page).not.toContain("like%20Banners");
  });

  it("shows product photos only on plans that include them", async () => {
    const withPhotos = await (await pageApp().request("/shop/adas-prints")).text();
    expect(withPhotos).toContain(`src="/shop/adas-prints/photo/${FLYER}"`);
    expect(withPhotos).toContain(`og:image" content="https://app.yarnoga.com/shop/adas-prints/photo/${FLYER}"`);
    const photo = await pageApp().request(`/shop/adas-prints/photo/${FLYER}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");

    const off = business({ photos: async () => false });
    expect(await (await pageApp(off).request("/shop/adas-prints")).text()).not.toContain("/photo/");
    expect((await pageApp(off).request(`/shop/adas-prints/photo/${FLYER}`)).status).toBe(404);
  });

  it("stays closed without the business's WhatsApp number, and is not found for unknown names", async () => {
    const closed = await (await pageApp(business({ whatsappNumber: null })).request("/shop/adas-prints")).text();
    expect(closed).toContain("isn&#39;t open yet");
    expect(closed).not.toContain("wa.me");
    expect((await pageApp().request("/shop/someone-else")).status).toBe(404);
    expect((await pageApp().request("/shop/x")).status).toBe(404);
  });

  it("speaks the business's language", async () => {
    const page = await (await pageApp(business({ lang: "fr", currency: "XOF" })).request("/shop/adas-prints")).text();
    expect(page).toContain("Commander sur WhatsApp");
    expect(page).toContain(`${formatMoney(15_000, "XOF")} l&#39;unité`);
  });

  it("shows a Pidgin-speaking business's page in English (Pidgin is for chats only)", async () => {
    const page = await (await pageApp(business({ lang: "pcm" })).request("/shop/adas-prints")).text();
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("Order on WhatsApp");
  });
});
