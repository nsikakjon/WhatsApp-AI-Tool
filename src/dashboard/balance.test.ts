import { describe, expect, it } from "vitest";
import { parseBalanceForm, summariseBalance, type BalanceItem, type BalanceKind, type BalanceStore, type HeldForShops, type NewBalanceItem } from "./balance.js";
import { createDashboard } from "./index.js";
import type { MoneyLine, MoneyStore } from "./profit.js";
import { NOW, sampleStats } from "./testing.js";

function item(id: number, kind: BalanceKind, amountKobo: number, asOf = "2026-10-15", name = `line ${id}`): BalanceItem {
  return { id, kind, item: name, amountMinor: amountKobo, currency: "NGN", usdRateKobo: null, amountKobo, asOf, notes: null };
}

const held: HeldForShops = { totalKobo: 3000000, shops: [{ name: "Ada Prints", kobo: 2000000 }, { name: "Bimbo Cakes", kobo: 1000000 }] };

function memoryStore(items: BalanceItem[] = [], shops: HeldForShops | Error = { totalKobo: 0, shops: [] }): BalanceStore & { items: BalanceItem[] } {
  return {
    items,
    async list() {
      return this.items;
    },
    async heldForShops() {
      if (shops instanceof Error) throw shops;
      return shops;
    },
    async add(i: NewBalanceItem) {
      this.items.push({ ...i, id: this.items.length + 1 });
    },
    async update(id: number, i: NewBalanceItem) {
      this.items = this.items.map((old) => (old.id === id ? { ...i, id } : old));
    },
    async remove(id: number) {
      this.items = this.items.filter((i) => i.id !== id);
    },
  };
}

describe("summariseBalance", () => {
  it("adds up what we own and owe, with the shops' payout money as owed", () => {
    const sheet = summariseBalance(
      [item(1, "cash", 5000000), item(2, "cash", 3500000), item(3, "owed_to_us", 450000), item(4, "bill", 685000)],
      held,
    );
    expect(sheet.ownsKobo).toBe(8950000);
    expect(sheet.owesKobo).toBe(3685000);
    expect(sheet.equityKobo).toBe(5265000);
    expect(sheet.groups.find((g) => g.kind === "cash")!.items.map((i) => i.id)).toEqual([1, 2]);
  });

  it("leaves the shops' money out when it couldn't load", () => {
    expect(summariseBalance([item(1, "cash", 100)], "error").owesKobo).toBe(0);
  });
});

describe("parseBalanceForm", () => {
  const good = { kind: "bill", item: "Supabase bill", currency: "USD", amount: "25", rate: "1,450", as_of: "2026-11-19" };

  it("turns a dollar bill into kobo at the typed rate", () => {
    expect(parseBalanceForm(good)).toMatchObject({ kind: "bill", amountMinor: 2500, usdRateKobo: 145000, amountKobo: 3625000, notes: null });
  });

  it("allows a zero balance", () => {
    expect(parseBalanceForm({ ...good, kind: "cash", currency: "NGN", amount: "0" })).toMatchObject({ amountKobo: 0 });
  });

  it("explains what's missing", () => {
    expect(parseBalanceForm({ ...good, kind: "shares" })).toHaveProperty("problem");
    expect(parseBalanceForm({ ...good, item: " " })).toHaveProperty("problem");
    expect(parseBalanceForm({ ...good, amount: "lots" })).toHaveProperty("problem");
    expect(parseBalanceForm({ ...good, rate: "" })).toHaveProperty("problem");
    expect(parseBalanceForm({ ...good, as_of: "today" })).toHaveProperty("problem");
  });
});

describe("balance sheet on the dashboard", () => {
  const host = "x.up.railway.app";
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: host };
  const post = (body: Record<string, string>, origin = `https://${host}`) =>
    ({ method: "POST", headers: { ...auth, Origin: origin }, body: new URLSearchParams(body) }) as const;
  const spent: MoneyLine = {
    id: 1,
    date: "2026-10-11",
    kind: "expense",
    item: "Ads",
    supplier: null,
    category: "Marketing",
    amountMinor: 20000000,
    currency: "NGN",
    usdRateKobo: null,
    amountKobo: 20000000,
    notes: null,
  };
  const money: MoneyStore = { list: async () => [spent], add: async () => {}, update: async () => {}, remove: async () => {} };

  function setup(items: BalanceItem[] = [], shops: HeldForShops | Error = held) {
    const balance = memoryStore(items, shops);
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, money, balance, now: () => NOW, log: { error: () => {} } });
    return { app, balance };
  }

  it("shows what we own, owe and what's left, and works out what the owner put in", async () => {
    const { app } = setup([item(1, "cash", 8000000, "2026-10-15", "Moniepoint account"), item(2, "bill", 685000, "2026-10-15", "Railway bill")]);
    const html = await (await app.request("/?tab=money&show=balance", { headers: auth })).text();
    expect(html).toContain('id="balance"');
    expect(html).toContain("Moniepoint account");
    expect(html).toContain("Shops' payout balances");
    expect(html).toContain("Ada Prints");
    expect(html).toContain("₦80,000"); // own
    expect(html).toContain("₦36,850"); // owe: 6,850 bill + 30,000 shops
    expect(html).toContain("₦43,150"); // left over
    // Cash ₦80,000 less shops' ₦30,000, plus ₦200,000 spent = ₦250,000 put in.
    expect(html).toContain("₦250,000");
    expect(html).toContain("−₦6,850"); // the bill, not in profit and loss yet
  });

  it("flags a line not checked for over a month", async () => {
    const { app } = setup([item(1, "cash", 100, "2026-09-01")]);
    const html = await (await app.request("/?tab=money&show=balance", { headers: auth })).text();
    expect(html).toContain("worth checking again");
  });

  it("adds, edits and removes lines from the dashboard only", async () => {
    const { app, balance } = setup();
    const add = await app.request("/balance", post({ kind: "cash", item: "Paystack balance", amount: "30000", currency: "NGN", as_of: "2026-10-16" }));
    expect(add.headers.get("location")).toBe("/dashboard?tab=money&show=balance#balance");
    expect(balance.items).toMatchObject([{ id: 1, kind: "cash", amountKobo: 3000000 }]);

    const edit = await app.request("/balance/1", post({ kind: "cash", item: "Paystack balance", amount: "", currency: "NGN", as_of: "2026-10-16" }));
    expect(edit.headers.get("location")).toMatch(/^\/dashboard\?tab=money&show=balance&edit=1&problem=.+#edit$/);
    await app.request("/balance/1", post({ kind: "cash", item: "Paystack balance", amount: "31000", currency: "NGN", as_of: "2026-10-16" }));
    expect(balance.items[0]!.amountKobo).toBe(3100000);

    const form = await (await app.request("/?tab=money&show=balance&edit=1", { headers: auth })).text();
    expect(form).toContain('action="/dashboard/balance/1"');

    expect((await app.request("/balance/1/delete", post({}, "https://evil.example"))).status).toBe(403);
    await app.request("/balance/1/delete", post({}));
    expect(balance.items).toHaveLength(0);
  });

  it("still shows the sheet when the shops' payout balances can't load", async () => {
    const { app } = setup([item(1, "cash", 100)], new Error("no payout_ledger"));
    const html = await (await app.request("/?tab=money&show=balance", { headers: auth })).text();
    expect(html).toContain("couldn't load, so they're left out");
  });

  it("says which migration to run when the table isn't there", async () => {
    const { app, balance } = setup();
    balance.list = async () => {
      throw new Error("relation balance_items does not exist");
    };
    const html = await (await app.request("/?tab=money&show=balance", { headers: auth })).text();
    expect(html).toContain("0095_balance_sheet.sql");
    expect(await (await app.request("/", { headers: auth })).text()).toContain("Balance sheet couldn&#39;t load");
  });
});
