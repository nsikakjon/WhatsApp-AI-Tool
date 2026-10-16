import { describe, expect, it } from "vitest";
import type { PriceListItem } from "./pricelist.js";
import { createQuoteSetup, readSettings } from "./setup.js";
import { DEFAULT_BUSINESS_ID, NumberTakenError, type BusinessStore, type QuoteBusiness, type SetupStore } from "./store.js";

const PASSWORD = "correct horse battery";
const OTHER_ID = "11111111-1111-1111-1111-111111111111";

function business(over: Partial<QuoteBusiness>): QuoteBusiness {
  return {
    id: OTHER_ID,
    name: "Mama Cakes",
    description: "a bakery",
    orderPrefix: "MC",
    phoneNumberId: "555000111",
    ownerWaId: null,
    businessDetails: null,
    paymentDetails: null,
    active: true,
    updatedAt: new Date(0),
    ...over,
  };
}

function memory() {
  const list: QuoteBusiness[] = [business({ id: DEFAULT_BUSINESS_ID, name: "KahnPrints", phoneNumberId: null }), business({})];
  const prices = new Map<string, PriceListItem[]>();
  const saves: Array<{ id: string; items: PriceListItem[] }> = [];
  const businesses: BusinessStore = {
    findByPhoneNumberId: async (n) => list.find((b) => b.phoneNumberId === n) ?? null,
    get: async (id) => list.find((b) => b.id === id) ?? null,
    list: async () => list,
  };
  const setup: SetupStore = {
    async createBusiness(s) {
      if (s.phoneNumberId && list.some((b) => b.phoneNumberId === s.phoneNumberId)) throw new NumberTakenError("taken");
      const b = { ...s, id: `22222222-2222-2222-2222-22222222222${list.length}`, updatedAt: new Date() };
      list.push(b);
      return b;
    },
    async updateBusiness(id, s) {
      const i = list.findIndex((b) => b.id === id);
      list[i] = { ...s, id, updatedAt: new Date() };
      return list[i]!;
    },
    priceList: async (id) => prices.get(id) ?? [],
    async replacePriceList(id, items) {
      saves.push({ id, items });
      prices.set(id, items);
    },
  };
  const app = createQuoteSetup({
    password: PASSWORD,
    businesses,
    setup,
    reservedNumberIds: ["99999"],
    multiBusinessOn: true,
    fetchSheet: async () => "Product,Price\nCupcakes,600",
    log: { error: () => undefined },
  });
  return { app, list, prices, saves };
}

const auth = { Authorization: `Basic ${Buffer.from(`owner:${PASSWORD}`).toString("base64")}` };
const sameSite = { ...auth, Origin: "https://bot.example.com", Host: "bot.example.com" };

function post(app: ReturnType<typeof memory>["app"], path: string, fields: Record<string, string>, headers: Record<string, string> = sameSite) {
  return app.request(path, { method: "POST", headers, body: new URLSearchParams(fields) });
}

describe("quote setup screen", () => {
  it("asks for the password", async () => {
    const { app } = memory();
    expect((await app.request("/")).status).toBe(401);
    const res = await app.request("/", { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("KahnPrints");
    expect(html).toContain("Mama Cakes");
  });

  it("refuses forms sent from another website", async () => {
    const { app, list } = memory();
    const res = await post(app, "/new", { name: "Evil", orderPrefix: "EV" }, { ...auth, Origin: "https://evil.example", Host: "bot.example.com" });
    expect(res.status).toBe(403);
    expect(list).toHaveLength(2);
  });

  it("adds a business and goes on to its price list", async () => {
    const { app, list } = memory();
    const res = await post(app, "/new", { name: " Ada  Gifts ", orderPrefix: "ag", phoneNumberId: "123456789", ownerWaId: "+234 801 234 5678", active: "on" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/quote-setup\/b\/.+\/prices\?new=1$/);
    expect(list.at(-1)).toMatchObject({ name: "Ada Gifts", orderPrefix: "AG", phoneNumberId: "123456789", ownerWaId: "2348012345678", active: true });
  });

  it("explains what's wrong with the settings", async () => {
    const { app } = memory();
    const res = await post(app, "/new", { name: "", orderPrefix: "TOOLONGX", phoneNumberId: "99999", active: "on" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Give the business a name");
    expect(html).toContain("1 to 6 letters");
    expect(html).toContain("already used by another yarnOga product");
  });

  it("says when another business has the number", async () => {
    const { app } = memory();
    const res = await post(app, "/new", { name: "Copy", orderPrefix: "CP", phoneNumberId: "555000111" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Another business already uses");
  });

  it("keeps the main number's settings on Railway", async () => {
    const { app, list } = memory();
    expect(await (await app.request(`/b/${DEFAULT_BUSINESS_ID}`, { headers: auth })).text()).toContain("set on Railway");
    const res = await post(app, `/b/${DEFAULT_BUSINESS_ID}`, { name: "Hacked", orderPrefix: "HK" });
    expect(res.status).toBe(400);
    expect(list[0]!.name).toBe("KahnPrints");
  });

  it("checks a pasted price list first and only saves when asked", async () => {
    const { app, saves } = memory();
    const pasted = "Product,Option,Minimum order,From quantity,Price\nCupcakes,box of 6,2,2,\"6,000\"\nCustom cakes,,1,,";
    const check = await app.request(`/b/${OTHER_ID}/prices/check`, {
      method: "POST",
      headers: sameSite,
      body: (() => {
        const f = new FormData();
        f.set("pasted", pasted);
        return f;
      })(),
    });
    expect(check.status).toBe(200);
    const html = await check.text();
    expect(html).toContain("₦6,000 each from 2");
    expect(html).toContain("priced by the team");
    expect(html).toContain("2 new");
    expect(saves).toHaveLength(0);

    const csv = html.match(/<textarea name="csv" hidden>([\s\S]*?)<\/textarea>/)![1]!.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    const save = await post(app, `/b/${OTHER_ID}/prices/save`, { csv });
    expect(save.status).toBe(303);
    expect(saves).toEqual([
      {
        id: OTHER_ID,
        items: [
          { product: "Cupcakes", option: "box of 6", minQuantity: 2, tiers: [{ minQuantity: 2, unitPriceKobo: 600_000 }] },
          { product: "Custom cakes", option: "Standard", minQuantity: 1, tiers: [] },
        ],
      },
    ]);
  });

  it("reads a Google Sheet link", async () => {
    const { app } = memory();
    const res = await post(app, `/b/${OTHER_ID}/prices/check`, { sheet: "https://docs.google.com/spreadsheets/d/abc/edit" });
    expect(await res.text()).toContain("₦600 each from 1");
  });

  it("shows bad rows and saves nothing", async () => {
    const { app, saves } = memory();
    const res = await post(app, `/b/${OTHER_ID}/prices/check`, { pasted: "Product,Price\nCupcakes,6k" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Row 2:");
    expect(saves).toHaveLength(0);
  });

  it("downloads the price list as CSV", async () => {
    const { app, prices } = memory();
    prices.set(OTHER_ID, [{ product: "Cupcakes", option: "box of 6", minQuantity: 2, tiers: [{ minQuantity: 2, unitPriceKobo: 600_050 }] }]);
    const res = await app.request(`/b/${OTHER_ID}/prices.csv`, { headers: auth });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(await res.text()).toBe("Product,Option,Minimum order,From quantity,Price (naira)\nCupcakes,box of 6,2,2,6000.50\n");
  });

  it("answers unknown businesses with not found", async () => {
    const { app } = memory();
    expect((await app.request("/b/not-an-id/prices", { headers: auth })).status).toBe(404);
  });
});

describe("readSettings", () => {
  it("won't switch a business on without its WhatsApp number", () => {
    const { problems } = readSettings({ name: "X", orderPrefix: "X", active: "on" }, []);
    expect(problems).toContain("Add the WhatsApp number ID before switching the business on.");
  });
});
