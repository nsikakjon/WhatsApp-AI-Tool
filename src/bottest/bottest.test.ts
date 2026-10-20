import { describe, expect, it } from "vitest";
import type { Product } from "../core/product.js";
import { createQuoteProduct } from "../products/quote/index.js";
import type { Variant } from "../products/quote/pricing.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BUSINESS_ID, type QuoteBusiness } from "../products/quote/store.js";
import { createTestBots, UnknownBusinessError } from "./bots.js";
import { loadBotTestConfig } from "./config.js";
import { createBotTest, type BotTestDeps } from "./index.js";
import { renderTestPage } from "./page.js";
import { DEFAULT_QUESTIONS } from "./questions.js";
import { TEST_OWNER, askBot, memoryLeadStore, memoryOrderStore } from "./sandbox.js";
import { newestPerQuestion, type MarkStore, type SavedMark } from "./store.js";

const AUTH = { Authorization: `Basic ${btoa("jay:a-long-test-password")}` };
const JSON_AUTH = { ...AUTH, "Content-Type": "application/json" };

function memoryMarks(): MarkStore & { rows: Array<SavedMark & { bot: string; business: string | null }> } {
  const rows: Array<SavedMark & { bot: string; business: string | null }> = [];
  return {
    rows,
    async save(bot, business, m) {
      rows.unshift({ ...m, bot, business, markedAt: new Date() });
    },
    async latest(bot, business) {
      return newestPerQuestion(rows.filter((r) => r.bot === bot && r.business === business));
    },
  };
}

/** A bot that echoes the question and alerts the owner, like a quote needing a hand-made price. */
const echoBot = (): Product => ({
  name: "fake",
  async handle(msg) {
    return { text: `You asked: ${msg.text}`, notify: [{ to: TEST_OWNER, text: "alert" }] };
  },
});

function screen(overrides: Partial<BotTestDeps> = {}) {
  const marks = memoryMarks();
  const app = createBotTest({
    password: "a-long-test-password",
    bots: { make: { quote: async () => echoBot() } },
    marks,
    dailyLimit: 3,
    log: { error: () => {} },
    ...overrides,
  });
  const ask = (body: unknown) => app.request("/ask", { method: "POST", headers: JSON_AUTH, body: JSON.stringify(body) });
  return { app, marks, ask };
}

describe("bot test screen", () => {
  it("asks for the password", async () => {
    const { app } = screen();
    expect((await app.request("/")).status).toBe(401);
    expect((await app.request("/", { headers: { Authorization: `Basic ${btoa("jay:wrong")}` } })).status).toBe(401);
    const page = await app.request("/", { headers: AUTH });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("bot test");
  });

  it("answers a question on screen and counts alerts without sending them", async () => {
    const { ask } = screen();
    const res = await ask({ bot: "quote", question: "How much is 100 flyers?" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "You asked: How much is 100 flyers?", pictures: 0, choices: [], alerts: 1 });
  });

  it("refuses bots that aren't switched on, empty questions and non-JSON posts", async () => {
    const { app, ask } = screen();
    expect((await ask({ bot: "leads", question: "hi" })).status).toBe(400);
    expect((await ask({ bot: "quote", question: "   " })).status).toBe(400);
    const form = await app.request("/ask", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: "bot=quote&question=hi",
    });
    expect(form.status).toBe(415);
  });

  it("stops at the daily limit", async () => {
    const { ask } = screen({ dailyLimit: 2, now: () => new Date("2026-10-16T12:00:00Z") });
    expect((await ask({ bot: "quote", question: "1" })).status).toBe(200);
    expect((await ask({ bot: "quote", question: "2" })).status).toBe(200);
    expect((await ask({ bot: "quote", question: "3" })).status).toBe(429);
  });

  it("saves marks and shows the newest one for each question", async () => {
    const { app } = screen();
    const save = (mark: string, note?: string) =>
      app.request("/marks", {
        method: "POST",
        headers: JSON_AUTH,
        body: JSON.stringify({ bot: "quote", question: "Price for 200 stickers", answer: "...", mark, note }),
      });
    expect((await save("good")).status).toBe(200);
    expect((await save("poor", "Should hand to the owner")).status).toBe(200);
    expect((await save("great")).status).toBe(400);

    const res = await app.request("/marks?bot=quote", { headers: AUTH });
    const { marks } = (await res.json()) as { marks: SavedMark[] };
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ mark: "poor", note: "Should hand to the owner" });
  });

  it("says when marks can't be saved (migration not run)", async () => {
    const broken: MarkStore = {
      save: async () => {
        throw new Error("relation does not exist");
      },
      latest: async () => {
        throw new Error("relation does not exist");
      },
    };
    const { app } = screen({ marks: broken });
    const res = await app.request("/marks", {
      method: "POST",
      headers: JSON_AUTH,
      body: JSON.stringify({ bot: "quote", question: "hi", answer: "hello", mark: "good" }),
    });
    expect(res.status).toBe(503);
    expect((await app.request("/marks?bot=quote", { headers: AUTH })).status).toBe(503);
  });

  it("puts the starter questions on the page safely", () => {
    const html = renderTestPage(["quote", "leads"]);
    expect(DEFAULT_QUESTIONS.quote.length).toBeGreaterThanOrEqual(20);
    expect(DEFAULT_QUESTIONS.leads.length).toBeGreaterThanOrEqual(20);
    expect(html).toContain("How much is 100 A5 flyers?");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("bot test screen with several businesses", () => {
  const SHOP = "11111111-1111-1111-1111-111111111111";
  const BAKERY = "22222222-2222-2222-2222-222222222222";
  const named = (name: string): Product => ({
    name: "fake",
    async handle(msg) {
      return { text: `${name}: ${msg.text}` };
    },
  });
  function multiScreen() {
    const marks = memoryMarks();
    const app = createBotTest({
      password: "a-long-test-password",
      bots: {
        make: {
          quote: async (business) => {
            if (!business) return named("main");
            if (business === BAKERY) return named("bakery");
            throw new UnknownBusinessError();
          },
        },
        businesses: async () => [
          { id: SHOP, name: "KahnPrints", live: true },
          { id: BAKERY, name: "Ada's Bakery", live: false },
        ],
      },
      marks,
      dailyLimit: 10,
      log: { error: () => {} },
    });
    const ask = (body: unknown) => app.request("/ask", { method: "POST", headers: JSON_AUTH, body: JSON.stringify(body) });
    return { app, marks, ask };
  }

  it("lists the businesses to pick from", async () => {
    const { app } = multiScreen();
    const { businesses } = (await (await app.request("/businesses", { headers: AUTH })).json()) as { businesses: unknown[] };
    expect(businesses).toHaveLength(2);
  });

  it("asks the chosen business's bot, even one that isn't live yet", async () => {
    const { ask } = multiScreen();
    expect(await (await ask({ bot: "quote", business: BAKERY, question: "cake?" })).json()).toMatchObject({ text: "bakery: cake?" });
    expect(await (await ask({ bot: "quote", question: "hi" })).json()).toMatchObject({ text: "main: hi" });
    const missing = await ask({ bot: "quote", business: "33333333-3333-3333-3333-333333333333", question: "hi" });
    expect(missing.status).toBe(400);
  });

  it("keeps each business's marks apart", async () => {
    const { app } = multiScreen();
    await app.request("/marks", {
      method: "POST",
      headers: JSON_AUTH,
      body: JSON.stringify({ bot: "quote", business: BAKERY, question: "cake?", answer: "x", mark: "poor" }),
    });
    const read = async (q: string) =>
      ((await (await app.request(`/marks?bot=quote${q}`, { headers: AUTH })).json()) as { marks: unknown[] }).marks;
    expect(await read(`&business=${BAKERY}`)).toHaveLength(1);
    expect(await read(`&business=${SHOP}`)).toHaveLength(0);
    expect(await read("")).toHaveLength(0);
  });
});

describe("createTestBots", () => {
  const business = (id: string, name: string, active: boolean): QuoteBusiness => ({
    id,
    name,
    description: null,
    orderPrefix: "AB",
    phoneNumberId: null,
    ownerWaId: "2348000000000",
    businessDetails: null,
    paymentDetails: null,
    active,
    updatedAt: new Date(),
  });
  const BAKERY = "22222222-2222-2222-2222-222222222222";
  const asked: string[] = [];
  const store = {
    findByPhoneNumberId: async () => null,
    get: async (id: string) => {
      asked.push(id);
      return id === BAKERY ? business(BAKERY, "Ada's Bakery", false) : null;
    },
    list: async () => [business(DEFAULT_BUSINESS_ID, "Business 1", true), business(BAKERY, "Ada's Bakery", false)],
  };
  const quote = { anthropicApiKey: "k", model: "m", businessName: "KahnPrints", orderPrefix: "KP" };
  const db = {} as SupabaseClient;

  it("uses Railway settings for business #1 and the table for the others", async () => {
    const bots = createTestBots(db, { quote, quoteBusinesses: { anthropicApiKey: "k", model: "m" } }, store);
    expect(await bots.businesses!()).toEqual([
      { id: DEFAULT_BUSINESS_ID, name: "KahnPrints", live: true },
      { id: BAKERY, name: "Ada's Bakery", live: false },
    ]);
    await bots.make.quote!(DEFAULT_BUSINESS_ID);
    await bots.make.quote!();
    expect(asked).toEqual([]);
    await bots.make.quote!(BAKERY);
    expect(asked).toEqual([BAKERY]);
    await expect(bots.make.quote!("33333333-3333-3333-3333-333333333333")).rejects.toBeInstanceOf(UnknownBusinessError);
  });

  it("has no business list when the quote bot runs one business", () => {
    const bots = createTestBots(db, { quote });
    expect(bots.businesses).toBeUndefined();
    expect(bots.make.quote).toBeDefined();
    expect(bots.make.leads).toBeUndefined();
  });
});

describe("sandbox", () => {
  const variants: Variant[] = [
    { id: "v-flyer", name: "Flyers: A5", minQuantity: 50, tiers: [{ minQuantity: 50, unitPriceKobo: 15_000 }] },
  ];

  it("prices from the price list and keeps the test quote in memory", async () => {
    const orders = memoryOrderStore();
    const bot = createQuoteProduct({
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: TEST_OWNER,
      catalog: { activeVariants: async () => variants },
      orders,
      ai: { understand: async () => ({ intent: "quote", items: [{ variantId: "v-flyer", quantity: 100 }], message: null }) },
    });
    const answer = await askBot(bot, "100 flyers please");
    expect(answer.text).toContain("₦15,000");
    expect(answer.alerts).toBe(0);
    expect(await orders.findOrder(1001)).toMatchObject({ status: "quoted", totalKobo: 1_500_000 });
  });

  it("gives every question a new pretend customer", async () => {
    const seen: string[] = [];
    const bot: Product = {
      name: "spy",
      async handle(msg, ctx) {
        seen.push(`${msg.from}|${ctx.contactId}`);
        return null;
      },
    };
    expect((await askBot(bot, "a")).text).toBe("");
    await askBot(bot, "b");
    expect(new Set(seen).size).toBe(2);
    expect(seen.every((s) => !/^\d+\|/.test(s))).toBe(true);
  });

  it("keeps test leads in memory", async () => {
    const store = memoryLeadStore();
    const lead = await store.saveLead("test-customer-1", {
      name: null,
      purpose: "rent",
      propertyType: "flat",
      location: "Lekki",
      budgetKobo: null,
      timeline: null,
      financing: null,
      wantsAgent: false,
      score: 20,
      temperature: "cold",
      status: "qualifying",
    });
    expect(await store.findLead("test-customer-1")).toEqual(lead);
    expect(await store.claimAlert(lead.id)).toBe(true);
    expect(await store.claimAlert(lead.id)).toBe(false);
  });
});

describe("loadBotTestConfig", () => {
  it("is off without a password and with a short one", () => {
    expect(loadBotTestConfig({})).toEqual({ status: "off" });
    expect(loadBotTestConfig({ BOT_TEST_PASSWORD: "short" })).toEqual({ status: "weak" });
    expect(loadBotTestConfig({ BOT_TEST_PASSWORD: "a-long-test-password", BOT_TEST_DAILY_LIMIT: "50" })).toEqual({
      status: "on",
      password: "a-long-test-password",
      dailyLimit: 50,
    });
  });
});
