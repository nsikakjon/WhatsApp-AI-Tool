import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import type { MoneyLine, MoneyStore } from "./profit.js";
import { compareWithPlan } from "./projection.js";
import { sampleStats } from "./testing.js";

function line(id: number, date: string, kind: MoneyLine["kind"], amountKobo: number, category: string | null): MoneyLine {
  return { id, date, kind, item: `item ${id}`, supplier: null, category, amountMinor: amountKobo, currency: "NGN", usdRateKobo: null, amountKobo, notes: null };
}

const lines = [
  line(1, "2026-10-11", "expense", 8243290, "Setup"),
  line(2, "2026-11-02", "expense", 1200000, "marketing"),
  line(3, "2026-11-04", "expense", 1781000, "Other"),
  line(4, "2026-11-06", "expense", 1500000, "Marketing"),
  line(5, "2026-11-08", "income", 450000, "Flyer plans"),
];

describe("compareWithPlan", () => {
  it("puts this month's ads, running costs and income next to the Base plan", () => {
    const plan = compareWithPlan(lines, "2026-11");
    expect(plan.months).toHaveLength(1);
    expect(plan.current).toEqual({
      month: "2026-11",
      planned: { adsKobo: 10610000, runningKobo: 15800000, incomeKobo: 0, netKobo: -26410000 },
      actual: { adsKobo: 2700000, runningKobo: 1781000, incomeKobo: 450000, netKobo: -4031000 },
    });
    expect(plan.ahead[0].month).toBe("2026-12");
    expect(plan.ahead.at(-1)!.month).toBe("2028-10");
  });

  it("leaves out costs from before the plan, and adds up every plan month so far", () => {
    const plan = compareWithPlan([...lines, line(6, "2026-12-01", "expense", 100, "Recurring")], "2027-01");
    expect(plan.months.map((m) => m.month)).toEqual(["2027-01", "2026-12", "2026-11"]);
    expect(plan.actual.runningKobo).toBe(1781100);
    expect(plan.planned.adsKobo).toBe(3 * 10610000);
    expect(plan.current?.actual).toEqual({ adsKobo: 0, runningKobo: 0, incomeKobo: 0, netKobo: 0 });
  });

  it("has nothing to compare before the plan starts or after it ends", () => {
    expect(compareWithPlan(lines, "2026-10").months).toEqual([]);
    const after = compareWithPlan(lines, "2029-01");
    expect(after.current).toBeNull();
    expect(after.months).toHaveLength(24);
  });
});

describe("the plan on the dashboard", () => {
  const auth = { Authorization: `Basic ${btoa("jay:secret")}` };
  const money: MoneyStore = { list: async () => lines, add: async () => {}, update: async () => {}, remove: async () => {} };
  const app = (now: Date) => createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, money, now: () => now });

  it("shows spending against the plan on the Money tab", async () => {
    const html = await (await app(new Date("2026-11-11T09:00:00Z")).request("/?tab=money", { headers: auth })).text();
    expect(html).toContain('id="plan"');
    expect(html).toContain("₦44,810");
    expect(html).toContain("of ₦264,100 planned for Nov 2026");
    expect(html).toContain("plan ₦106,100");
  });

  it("flags a month that spends more than planned", async () => {
    const over = [...lines, line(9, "2026-11-10", "expense", 30000000, "Recurring")];
    const html = await (
      await createDashboard({
        password: "secret",
        stats: { load: async () => sampleStats() },
        money: { ...money, list: async () => over },
        now: () => new Date("2026-11-11T09:00:00Z"),
      }).request("/", { headers: auth })
    ).text();
    expect(html).toContain("Spending this month is over the plan");
  });
});
