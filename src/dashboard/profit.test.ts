import { describe, expect, it } from "vitest";
import { createDashboard, fromDashboard } from "./index.js";
import { parseHundredths, parseMoneyForm, summariseMoney, usdToKobo, type MoneyLine, type MoneyStore, type NewMoneyLine } from "./profit.js";
import { NOW, sampleStats } from "./testing.js";

function line(id: number, date: string, kind: MoneyLine["kind"], amountKobo: number, category: string | null = null): MoneyLine {
  return {
    id,
    date,
    kind,
    item: `item ${id}`,
    supplier: null,
    category,
    amountMinor: amountKobo,
    currency: "NGN",
    usdRateKobo: null,
    amountKobo,
    notes: null,
  };
}

function memoryStore(lines: MoneyLine[] = []): MoneyStore & { lines: MoneyLine[] } {
  return {
    lines,
    async list() {
      return this.lines;
    },
    async add(l: NewMoneyLine) {
      this.lines.push({ ...l, id: this.lines.length + 1 });
    },
    async remove(id: number) {
      this.lines = this.lines.filter((l) => l.id !== id);
    },
  };
}

describe("money amounts", () => {
  it("reads typed amounts as whole hundredths, without floating point", () => {
    expect(parseHundredths("20.18")).toBe(2018);
    expect(parseHundredths("₦12,500.5")).toBe(1250050);
    expect(parseHundredths("$5")).toBe(500);
    expect(parseHundredths("0.1")).toBe(10);
    expect(parseHundredths("1.234")).toBeNull();
    expect(parseHundredths("-5")).toBeNull();
    expect(parseHundredths("abc")).toBeNull();
  });

  it("converts dollars at the given rate, to the nearest kobo", () => {
    expect(usdToKobo(2018, 137000)).toBe(2764660); // $20.18 at ₦1,370 = ₦27,646.60
    expect(usdToKobo(1, 145050)).toBe(1451); // 1 cent at ₦1,450.50 = 14.505 kobo, rounded
  });

  it("matches the ledger's total of ₦82,432.90 for the costs copied from it", () => {
    const kobo = [2018, 999, 500, 500, 2000].reduce((sum, c) => sum + usdToKobo(c, 137000), 0);
    expect(kobo).toBe(8243290);
  });
});

describe("summariseMoney", () => {
  it("adds up income, costs and profit per month and by category", () => {
    const pnl = summariseMoney([
      line(1, "2026-10-11", "expense", 2764660, "Setup"),
      line(2, "2026-10-20", "income", 450000, "Flyer plans"),
      line(3, "2026-11-11", "expense", 685000, "Recurring"),
      line(4, "2026-11-12", "income", 1000000, "Flyer plans"),
      line(5, "2026-10-12", "expense", 100000, null),
    ]);
    expect(pnl.incomeKobo).toBe(1450000);
    expect(pnl.expensesKobo).toBe(3549660);
    expect(pnl.netKobo).toBe(-2099660);
    expect(pnl.months).toEqual([
      { month: "2026-11", incomeKobo: 1000000, expensesKobo: 685000, netKobo: 315000 },
      { month: "2026-10", incomeKobo: 450000, expensesKobo: 2864660, netKobo: -2414660 },
    ]);
    expect(pnl.expensesByCategory.map((c) => c.category)).toEqual(["Setup", "Recurring", "Other"]);
    expect(pnl.incomeByCategory).toEqual([{ category: "Flyer plans", kobo: 1450000 }]);
    expect(pnl.lines[0].id).toBe(4);
  });

  it("suggests the last dollar rate used, or the ledger's rate", () => {
    expect(summariseMoney([]).lastUsdRateKobo).toBe(137000);
    const usd = { ...line(1, "2026-10-11", "expense", 0), currency: "USD" as const, usdRateKobo: 150000 };
    expect(summariseMoney([usd]).lastUsdRateKobo).toBe(150000);
  });
});

describe("parseMoneyForm", () => {
  const good = { date: "2026-11-11", kind: "expense", item: "Railway", currency: "USD", amount: "5", rate: "1,450" };

  it("turns a dollar cost into kobo at the typed rate", () => {
    expect(parseMoneyForm(good)).toMatchObject({ amountMinor: 500, usdRateKobo: 145000, amountKobo: 725000, supplier: null });
  });

  it("ignores the rate for naira", () => {
    expect(parseMoneyForm({ ...good, currency: "NGN", amount: "4500" })).toMatchObject({ amountKobo: 450000, usdRateKobo: null });
  });

  it("explains what's missing", () => {
    expect(parseMoneyForm({ ...good, amount: "five" })).toHaveProperty("problem");
    expect(parseMoneyForm({ ...good, amount: "0" })).toHaveProperty("problem");
    expect(parseMoneyForm({ ...good, rate: "" })).toHaveProperty("problem");
    expect(parseMoneyForm({ ...good, item: " " })).toHaveProperty("problem");
    expect(parseMoneyForm({ ...good, kind: "gift" })).toHaveProperty("problem");
    expect(parseMoneyForm({ ...good, date: "yesterday" })).toHaveProperty("problem");
  });
});

describe("fromDashboard", () => {
  it("only accepts forms sent from the dashboard's own address", () => {
    expect(fromDashboard("https://x.up.railway.app", undefined, "x.up.railway.app")).toBe(true);
    expect(fromDashboard(undefined, "https://x.up.railway.app/dashboard", "x.up.railway.app")).toBe(true);
    expect(fromDashboard("https://evil.example", undefined, "x.up.railway.app")).toBe(false);
    expect(fromDashboard(undefined, undefined, "x.up.railway.app")).toBe(false);
  });
});

describe("profit and loss on the dashboard", () => {
  const host = "x.up.railway.app";
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: host };
  const post = (path: string, body: Record<string, string>, origin = `https://${host}`) =>
    ({ method: "POST", headers: { ...auth, Origin: origin }, body: new URLSearchParams(body) }) as const;

  function setup(lines: MoneyLine[] = []) {
    const money = memoryStore(lines);
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, money, now: () => NOW });
    return { app, money };
  }

  it("shows profit or loss from the entries, and says income isn't recorded automatically", async () => {
    const { app } = setup([line(1, "2026-10-11", "expense", 8243290, "Setup")]);
    const html = await (await app.request("/", { headers: auth })).text();
    expect(html).toContain('id="money"');
    expect(html).toContain("Loss so far");
    expect(html).toContain("−₦82,432.90");
    expect(html).toContain("aren&#39;t recorded automatically");
  });

  it("adds an entry from the form and goes back to the section", async () => {
    const { app, money } = setup();
    const res = await app.request(
      "/money",
      post("/money", { date: "2026-10-16", kind: "income", item: "Standard plan", amount: "4,500", currency: "NGN", rate: "1370" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dashboard#money");
    expect(money.lines).toMatchObject([{ kind: "income", amountKobo: 450000 }]);
  });

  it("sends a bad entry back with the reason", async () => {
    const { app, money } = setup();
    const res = await app.request("/money", post("/money", { date: "2026-10-16", kind: "income", item: "x", amount: "", currency: "NGN" }));
    expect(res.headers.get("location")).toContain("problem=");
    expect(money.lines).toHaveLength(0);
  });

  it("removes an entry", async () => {
    const { app, money } = setup([line(7, "2026-10-11", "expense", 100)]);
    const res = await app.request("/money/7/delete", post("/money/7/delete", {}));
    expect(res.status).toBe(303);
    expect(money.lines).toHaveLength(0);
  });

  it("refuses forms posted from another site, or without the password", async () => {
    const { app, money } = setup([line(7, "2026-10-11", "expense", 100)]);
    expect((await app.request("/money/7/delete", post("/money/7/delete", {}, "https://evil.example"))).status).toBe(403);
    expect((await app.request("/money/7/delete", { method: "POST" })).status).toBe(401);
    expect(money.lines).toHaveLength(1);
  });

  it("still shows the rest of the dashboard when the table isn't there yet", async () => {
    const money = memoryStore();
    money.list = async () => {
      throw new Error("relation money_lines does not exist");
    };
    const app = createDashboard({
      password: "secret",
      stats: { load: async () => sampleStats() },
      money,
      log: { error: () => {} },
    });
    const res = await app.request("/", { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0024_money_lines.sql");
    expect(html).toContain("Sales assistant");
  });
});
