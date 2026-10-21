import { describe, expect, it } from "vitest";
import type { PriceListDraft, PriceListDrafter } from "./drafter.js";
import type { PriceListItem } from "./pricelist.js";
import { createQuoteSetup, readSettings, type QuoteSetupDeps } from "./setup.js";
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

function memory(extra: Partial<QuoteSetupDeps> = {}) {
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
    ...extra,
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

describe("AI draft of a price list", () => {
  function withDrafter(draft: PriceListDraft, extra: Partial<QuoteSetupDeps> = {}) {
    const calls: Array<Parameters<PriceListDrafter["draft"]>[0]> = [];
    const drafter: PriceListDrafter = {
      async draft(input) {
        calls.push(input);
        return draft;
      },
    };
    return { ...memory({ drafter, ...extra }), calls };
  }

  function draftForm(fields: Record<string, string>, photos: File[] = []) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    for (const p of photos) f.append("photos", p);
    return f;
  }

  const cupcakes: PriceListDraft = {
    rows: [
      { product: "Cupcakes", option: "box of 6", minQuantity: 2, fromQuantity: null, price: "3500" },
      { product: "Birthday cakes", option: "Standard", minQuantity: null, fromQuantity: null, price: "99000" },
      { product: "Custom cakes", option: "Standard", minQuantity: null, fromQuantity: null, price: null },
    ],
    notes: "Check the cake sizes.",
  };

  it("only shows the button when switched on", async () => {
    const off = memory();
    expect(await (await off.app.request(`/b/${OTHER_ID}/prices`, { headers: auth })).text()).not.toContain("Let AI draft it");
    const on = withDrafter(cupcakes);
    expect(await (await on.app.request(`/b/${OTHER_ID}/prices`, { headers: auth })).text()).toContain("Let AI draft it");
    const res = await off.app.request(`/b/${OTHER_ID}/prices/draft`, { method: "POST", headers: sameSite, body: draftForm({ describe: "x" }) });
    expect(res.status).toBe(404);
  });

  it("fills the box with draft rows, blanks prices the owner never typed, and saves nothing", async () => {
    const { app, saves, calls } = withDrafter(cupcakes);
    const res = await app.request(`/b/${OTHER_ID}/prices/draft`, {
      method: "POST",
      headers: sameSite,
      body: draftForm({ describe: "Cupcakes box of 6 for N3,500, min 2 boxes. Birthday cakes and custom cakes too." }),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("only a draft, nothing is saved");
    expect(html).toContain("Cupcakes,box of 6,2,,3500");
    expect(html).toContain("Birthday cakes,Standard,,,\n"); // 99000 isn't in the text
    expect(html).not.toContain("99000");
    expect(html).toContain("1 price was left empty");
    expect(html).toContain("Check the cake sizes.");
    expect(calls[0]).toMatchObject({ businessName: "Mama Cakes", description: "a bakery", images: [] });
    expect(saves).toHaveLength(0);
  });

  it("sends photos to the AI and keeps the prices it read from them", async () => {
    const { app, calls } = withDrafter(cupcakes);
    const photo = new File([new Uint8Array([1, 2, 3])], "menu.jpg", { type: "image/jpeg" });
    const res = await app.request(`/b/${OTHER_ID}/prices/draft`, { method: "POST", headers: sameSite, body: draftForm({}, [photo]) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Birthday cakes,Standard,,,99000");
    expect(calls[0]!.images).toEqual([{ mediaType: "image/jpeg", data: "AQID" }]);
  });

  it("refuses too many photos, files that aren't photos, and empty requests", async () => {
    const { app, calls } = withDrafter(cupcakes);
    const jpg = () => new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" });
    const four = await app.request(`/b/${OTHER_ID}/prices/draft`, { method: "POST", headers: sameSite, body: draftForm({}, [jpg(), jpg(), jpg(), jpg()]) });
    expect(four.status).toBe(400);
    expect(await four.text()).toContain("up to 3 photos");
    const pdf = await app.request(`/b/${OTHER_ID}/prices/draft`, {
      method: "POST",
      headers: sameSite,
      body: draftForm({}, [new File(["%PDF"], "list.pdf", { type: "application/pdf" })]),
    });
    expect(pdf.status).toBe(400);
    const empty = await app.request(`/b/${OTHER_ID}/prices/draft`, { method: "POST", headers: sameSite, body: draftForm({ describe: "  " }) });
    expect(empty.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("stops after the daily limit", async () => {
    const { app, calls } = withDrafter(cupcakes, { draftsPerDay: 1 });
    const send = () => app.request(`/b/${OTHER_ID}/prices/draft`, { method: "POST", headers: sameSite, body: draftForm({ describe: "Cupcakes 600" }) });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it("refuses drafts sent from another website", async () => {
    const { app, calls } = withDrafter(cupcakes);
    const res = await app.request(`/b/${OTHER_ID}/prices/draft`, {
      method: "POST",
      headers: { ...auth, Origin: "https://evil.example", Host: "bot.example.com" },
      body: draftForm({ describe: "Cupcakes 600" }),
    });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe("branches", () => {
  const branch = { name: "Mama Cakes Ikeja", orderPrefix: "MCI", phoneNumberId: "555000222", active: "on" };

  it("adds a branch when the main business's plan has room", async () => {
    const { app, list } = memory({ branches: { limit: async () => 3 } });
    expect(await (await app.request("/new", { headers: auth })).text()).toContain('<option value="11111111-1111-1111-1111-111111111111">Mama Cakes</option>');
    expect((await post(app, "/new", { ...branch, branchOf: OTHER_ID })).status).toBe(303);
    expect(list.at(-1)?.branchOf).toBe(OTHER_ID);
    const third = await post(app, "/new", { ...branch, phoneNumberId: "555000333", branchOf: OTHER_ID });
    expect(third.status).toBe(303);
    const fourth = await post(app, "/new", { ...branch, phoneNumberId: "555000444", branchOf: OTHER_ID });
    expect(await fourth.text()).toContain("allows 3 numbers in all");
  });

  it("explains when the plan has no branches, and keeps branches one level deep", async () => {
    const { app } = memory({ branches: { limit: async () => 1 } });
    expect(await (await post(app, "/new", { ...branch, branchOf: OTHER_ID })).text()).toContain("include branches. Growth allows up to 3 numbers");

    const open = memory({ branches: { limit: async () => null } });
    await post(open.app, "/new", { ...branch, branchOf: OTHER_ID });
    const branchId = open.list.at(-1)!.id;
    const nested = await post(open.app, "/new", { ...branch, phoneNumberId: "555000333", branchOf: branchId });
    expect(await nested.text()).toContain("Pick the main business");
    const mainAsBranch = await post(open.app, `/b/${OTHER_ID}`, { name: "Mama Cakes", orderPrefix: "MC", branchOf: DEFAULT_BUSINESS_ID });
    expect(await mainAsBranch.text()).toContain("has branches of its own, so it can");
  });

  it("shows no branch choice and never writes it while branches are off", async () => {
    const { app, list } = memory();
    expect(await (await app.request("/new", { headers: auth })).text()).not.toContain("Branch of");
    await post(app, "/new", { ...branch, branchOf: OTHER_ID });
    expect(list.at(-1)?.branchOf).toBeUndefined();
  });
});
