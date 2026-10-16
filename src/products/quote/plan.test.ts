import { describe, expect, it } from "vitest";
import { CREDIT_LINE, createPlanGate, lagosMonthStart, type PlanStore, type QuotePlan } from "./plan.js";

const plans: QuotePlan[] = [
  { code: "free", name: "Free", monthlyPriceKobo: 0, setupFeeKobo: 0, monthlyOrderLimit: 50, showCredit: true },
  { code: "starter", name: "Starter", monthlyPriceKobo: 2_500_000, setupFeeKobo: 7_500_000, monthlyOrderLimit: null, showCredit: false },
];

function store(used: number, overrides: Partial<PlanStore> = {}): PlanStore & { since: Date[] } {
  const since: Date[] = [];
  return {
    since,
    plan: async (code) => plans.find((p) => p.code === code) ?? null,
    paidPlans: async () => plans.filter((p) => p.monthlyPriceKobo > 0),
    ordersConfirmedSince: async (d) => {
      since.push(d);
      return used;
    },
    ...overrides,
  };
}

const quiet = { error() {} };

describe("lagosMonthStart", () => {
  it("is midnight on the 1st in Lagos, even late on the last day in UTC", () => {
    expect(lagosMonthStart(new Date("2026-10-16T12:00:00Z")).toISOString()).toBe("2026-09-30T23:00:00.000Z");
    // 23:30 UTC on 31 Oct is already 1 Nov in Lagos.
    expect(lagosMonthStart(new Date("2026-10-31T23:30:00Z")).toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
});

describe("plan gate", () => {
  it("lets free orders through until the monthly limit, warning near the end", async () => {
    const s = store(10);
    const gate = createPlanGate({ code: "free", store: s, now: () => new Date("2026-10-16T12:00:00Z") });
    expect(await gate.checkOrder()).toEqual({ allowed: true, warning: null });
    expect(s.since[0]?.toISOString()).toBe("2026-09-30T23:00:00.000Z");

    expect(await createPlanGate({ code: "free", store: store(46) }).checkOrder()).toEqual({
      allowed: true,
      warning: "This is order 47 of 50 on your Free plan this month.",
    });
    const last = await createPlanGate({ code: "free", store: store(49) }).checkOrder();
    expect(last.allowed && last.warning).toContain("order 50 of 50");
    expect(last.allowed && last.warning).toContain("Send *plan*");
  });

  it("stops at the limit", async () => {
    expect(await createPlanGate({ code: "free", store: store(50) }).checkOrder()).toEqual({
      allowed: false,
      used: 50,
      limit: 50,
      planName: "Free",
    });
  });

  it("never limits a paid plan or shows its credit line", async () => {
    const gate = createPlanGate({ code: "starter", store: store(5000) });
    expect(await gate.checkOrder()).toEqual({ allowed: true, warning: null });
    expect(await gate.credit()).toBeNull();
    expect(await createPlanGate({ code: "free", store: store(0) }).credit()).toBe(CREDIT_LINE);
  });

  it("lets orders through when the plan is unknown or the database fails", async () => {
    expect(await createPlanGate({ code: "gold", store: store(999), log: quiet }).checkOrder()).toEqual({ allowed: true, warning: null });
    const broken = store(999, { ordersConfirmedSince: async () => Promise.reject(new Error("down")) });
    expect(await createPlanGate({ code: "free", store: broken, log: quiet }).checkOrder()).toEqual({ allowed: true, warning: null });
    const noPlan = store(0, { plan: async () => Promise.reject(new Error("down")) });
    expect(await createPlanGate({ code: "free", store: noPlan, log: quiet }).credit()).toBeNull();
  });

  it("summarises use and upgrade options with prices from the plans table", async () => {
    const text = await createPlanGate({ code: "free", store: store(12) }).summary();
    expect(text).toContain("Your plan: *Free*");
    expect(text).toContain("Orders this month: 12 of 50");
    expect(text).toContain("• Starter: ₦25,000/month + ₦75,000 setup");
    expect(text).toContain("contact yarnOga");
  });

  it("puts a payment link under each upgrade once one can be made", async () => {
    const text = await createPlanGate({ code: "free", store: store(0), upgradeLink: async (p) => `https://pay.example/${p.code}` }).summary();
    expect(text).toContain("https://pay.example/starter");
    expect(text).not.toContain("contact yarnOga");
  });
});
