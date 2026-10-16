import { describe, expect, it } from "vitest";
import type { Product } from "../core/product.js";
import { createQuoteProduct } from "../products/quote/index.js";
import type { Variant } from "../products/quote/pricing.js";
import { loadBotTestConfig } from "./config.js";
import { createBotTest, type BotTestDeps } from "./index.js";
import { renderTestPage } from "./page.js";
import { DEFAULT_QUESTIONS } from "./questions.js";
import { TEST_OWNER, askBot, memoryLeadStore, memoryOrderStore } from "./sandbox.js";
import { newestPerQuestion, type MarkStore, type SavedMark } from "./store.js";

const AUTH = { Authorization: `Basic ${btoa("jay:a-long-test-password")}` };
const JSON_AUTH = { ...AUTH, "Content-Type": "application/json" };

function memoryMarks(): MarkStore & { rows: Array<SavedMark & { bot: string }> } {
  const rows: Array<SavedMark & { bot: string }> = [];
  return {
    rows,
    async save(bot, m) {
      rows.unshift({ ...m, bot, markedAt: new Date() });
    },
    async latest(bot) {
      return newestPerQuestion(rows.filter((r) => r.bot === bot));
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
    bots: { quote: echoBot },
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
