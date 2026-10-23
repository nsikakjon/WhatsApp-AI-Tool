import { describe, expect, it } from "vitest";
import type { CheckoutLink, PaymentRequest } from "../../core/payments/payments.js";
import {
  CREDIT_LINE,
  createPlanGate,
  createPlanPaidHandler,
  lagosMonthStart,
  type PlanPaymentStore,
  type PlanStore,
  type QuotePlan,
} from "./plan.js";

const plans: QuotePlan[] = [
  { code: "free", name: "Free", monthlyPriceKobo: 0, monthlyPricePaidYearlyKobo: null, setupFeeKobo: 0, monthlyOrderLimit: 50, showCredit: true },
  { code: "starter", name: "Starter", monthlyPriceKobo: 750_000, monthlyPricePaidYearlyKobo: 600_000, setupFeeKobo: 0, monthlyOrderLimit: null, showCredit: false },
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

  it("reads the plan from the business's own row when no code is given", async () => {
    const onFree = createPlanGate({ store: store(50, { businessPlanCode: async () => "free" }) });
    expect((await onFree.checkOrder()).allowed).toBe(false);
    expect(await onFree.credit()).toBe(CREDIT_LINE);
    const noPlan = createPlanGate({ store: store(5000, { businessPlanCode: async () => null }) });
    expect(await noPlan.checkOrder()).toEqual({ allowed: true, warning: null });
    expect(await noPlan.credit()).toBeNull();
  });

  it("summarises use and upgrade options with prices from the plans table", async () => {
    const text = await createPlanGate({ code: "free", store: store(12) }).summary();
    expect(text).toContain("Your plan: *Free*");
    expect(text).toContain("Orders this month: 12 of 50");
    expect(text).toContain("• Starter: ₦7,500/month (₦6,000/month paid yearly, ₦72,000 a year)");
    expect(text).not.toContain("setup");
    expect(text).toContain("contact yarnOga");
  });

  it("says what each higher plan adds", async () => {
    const pro: QuotePlan = {
      code: "pro", name: "Pro", monthlyPriceKobo: 2_300_000, monthlyPricePaidYearlyKobo: 1_925_000, setupFeeKobo: 0,
      monthlyOrderLimit: null, showCredit: false, description: "delivery and riders, broadcasts",
    };
    const s = store(0, { paidPlans: async () => [plans[1]!, pro] });
    const text = await createPlanGate({ code: "starter", store: s }).summary();
    expect(text).toContain("• Pro: ₦23,000/month (₦19,250/month paid yearly, ₦231,000 a year). Delivery and riders, broadcasts");
    expect(text).not.toContain("• Starter");
  });

  it("lists the optional assisted setup with its price", async () => {
    const s = store(0, { addons: async () => [{ name: "We set it up for you", priceKobo: 2_500_000 }] });
    const text = await createPlanGate({ code: "starter", store: s }).summary();
    expect(text).toContain("• We set it up for you: ₦25,000");
    expect(text).toContain("contact yarnOga");
  });

  it("tells owners how to upgrade in the chat once payments are on", async () => {
    const text = await createPlanGate({ code: "free", store: store(0), checkout: checkout().value }).summary();
    expect(text).toContain("send *upgrade starter* to pay for a month, or *upgrade starter yearly* for a year");
    expect(text).not.toContain("contact yarnOga");
  });

  it("lets a saved or paid plan on the business's row win over QUOTE_PLAN", async () => {
    const gate = createPlanGate({ code: "free", store: store(500, { businessPlanCode: async () => "starter" }) });
    expect(await gate.checkOrder()).toEqual({ allowed: true, warning: null });
    const broken = createPlanGate({ code: "free", store: store(50, { businessPlanCode: () => Promise.reject(new Error("no column")) }), log: quiet });
    expect((await broken.checkOrder()).allowed).toBe(false);
  });
});

function checkout() {
  const requests: PaymentRequest[] = [];
  const value = {
    businessId: "b1",
    links: {
      createLink: async (req: PaymentRequest): Promise<CheckoutLink> => {
        requests.push(req);
        if (req.promo && req.promo.code !== "DAYONES") return { url: null, refused: { result: "full", code: req.promo.code, maxUses: 10 } };
        const off = req.promo ? req.amountKobo / req.promo.months / 2 : 0;
        return {
          url: "https://checkout.paystack.com/abc",
          amountKobo: req.amountKobo - off,
          promo: req.promo ? { code: "DAYONES", percentOff: 50, amountOffKobo: off } : null,
        };
      },
    },
  };
  return { value, requests };
}

describe("plan upgrades", () => {
  it("makes a Paystack link for a month at the monthly price from the plans table", async () => {
    const c = checkout();
    const text = await createPlanGate({ code: "free", store: store(0), checkout: c.value }).upgrade!("starter", "2348000000001");
    expect(text).toContain("*Starter* (1 month, ₦7,500)");
    expect(text).toContain("https://checkout.paystack.com/abc");
    expect(c.requests).toEqual([
      { product: "quote", waId: "2348000000001", amountKobo: 750_000, purpose: { businessId: "b1", plan: "starter", months: 1 }, title: "yarnOga Starter, 1 month" },
    ]);
  });

  it("charges a year at the yearly price", async () => {
    const c = checkout();
    const text = await createPlanGate({ code: "free", store: store(0), checkout: c.value }).upgrade!("Starter yearly", "2348000000001");
    expect(text).toContain("(1 year, ₦72,000)");
    expect(c.requests[0]?.amountKobo).toBe(7_200_000);
    expect(c.requests[0]?.purpose).toEqual({ businessId: "b1", plan: "starter", months: 12 });
  });

  it("takes a promo code typed at the end and shows the discounted price", async () => {
    const c = checkout();
    const gate = createPlanGate({ code: "free", store: store(0), checkout: c.value });
    const text = await gate.upgrade!("starter yearly dayones", "2348000000001");
    expect(c.requests[0]).toMatchObject({ amountKobo: 7_200_000, promo: { code: "DAYONES", months: 12 } });
    expect(text).toContain("(1 year, ₦69,000)");
    expect(text).toContain("50% off your first month, so you save ₦3,000");
    expect(await gate.upgrade!("starter OTHER1", "2348000000001")).toContain("first 10 subscribers");
  });

  it("uses the code given at sign-up, and charges the full price once it no longer applies", async () => {
    const c = checkout();
    const withDayones = createPlanGate({ code: "free", store: store(0, { signupCode: async () => "DAYONES" }), checkout: c.value });
    expect(await withDayones.upgrade!("starter", "1")).toContain("50% off your first month");

    const ended = createPlanGate({ code: "free", store: store(0, { signupCode: async () => "OTHER1" }), checkout: c.value });
    const text = await ended.upgrade!("starter", "1");
    expect(text).toContain("(1 month, ₦7,500)");
    expect(c.requests.slice(1).map((r) => r.promo?.code)).toEqual(["OTHER1", undefined]);
  });

  it("asks which plan when it doesn't know the name, and never charges for the free plan", async () => {
    const c = checkout();
    const gate = createPlanGate({ code: "free", store: store(0), checkout: c.value });
    expect(await gate.upgrade!("gold", "1")).toBe("Which plan? Send *upgrade starter*. Send *plan* to see the prices.");
    expect(await gate.upgrade!("free", "1")).toContain("Which plan?");
    expect(c.requests).toHaveLength(0);
  });

  it("points to yarnOga when payments aren't switched on or Paystack fails", async () => {
    expect(await createPlanGate({ code: "free", store: store(0) }).upgrade!("starter", "1")).toContain("contact yarnOga");
    const failing = { businessId: "b1", links: { createLink: () => Promise.reject(new Error("down")) } };
    expect(await createPlanGate({ code: "free", store: store(0), checkout: failing, log: quiet }).upgrade!("starter", "1")).toContain(
      "couldn't make a payment link",
    );
  });
});

describe("plan paid handler", () => {
  const payment = (purpose: Record<string, unknown>) => ({
    id: "p1",
    reference: "yarnoga-quote-1",
    product: "quote",
    waId: "2348000000001",
    purpose,
    amountKobo: 750_000,
    status: "paid" as const,
  });

  function saving() {
    const saved: Array<[string, string, number]> = [];
    const store: PlanPaymentStore = {
      extendPlan: async (b, code, months) => {
        saved.push([b, code, months]);
        return new Date("2026-11-21T10:00:00Z");
      },
    };
    return { store, saved };
  }

  it("puts the business on the plan and thanks the main number's owner", async () => {
    const s = saving();
    const notes = await createPlanPaidHandler({ store: s.store, mainBusinessId: "main" })(payment({ businessId: "main", plan: "starter", months: 1 }));
    expect(s.saved).toEqual([["main", "starter", 1]]);
    expect(notes).toEqual([{ to: "2348000000001", text: "✅ Payment of ₦7,500 received, thank you. You're on the plan until 21 November 2026." }]);
  });

  it("sends no WhatsApp message for other businesses", async () => {
    const s = saving();
    expect(await createPlanPaidHandler({ store: s.store, mainBusinessId: "main" })(payment({ businessId: "b2", plan: "starter", months: 12 }))).toEqual([]);
    expect(s.saved).toEqual([["b2", "starter", 12]]);
  });

  it("refuses a payment it can't match to a plan, so it can be retried", async () => {
    const s = saving();
    await expect(createPlanPaidHandler({ store: s.store, mainBusinessId: "main" })(payment({ plan: "starter" }))).rejects.toThrow("can't find");
    expect(s.saved).toHaveLength(0);
  });
});
