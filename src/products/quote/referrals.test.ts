import { describe, expect, it } from "vitest";
import type { PlanPaymentStore } from "./plan.js";
import { createPlanPaidHandler } from "./plan.js";
import { newReferralCode, referralReply, rewardReferrer, type ReferralStore } from "./referrals.js";
import type { Payment } from "../../core/payments/store.js";

const NOW = new Date("2026-11-01T10:00:00Z");
const MAIN = "00000000-0000-0000-0000-000000000001";

function setup(saved: { code: string | null; until: Date | null }) {
  const extended: Array<[string, string, number]> = [];
  const store: ReferralStore = {
    codeFor: async () => ({ code: "KAHNP4821", percentOff: 10 }),
    timesUsed: async () => 2,
    referrerOf: async (code) => (code === "KAHNP4821" ? "b1" : code === "MAINS1000" ? MAIN : null),
    savedPlan: async () => saved,
  };
  const plans: PlanPaymentStore = {
    async extendPlan(businessId, code, months) {
      extended.push([businessId, code, months]);
      return NOW;
    },
  };
  const reward = (code: string) => rewardReferrer({ code, store, plans, mainBusinessId: MAIN, now: NOW });
  return { store, plans, extended, reward };
}

describe("referral codes", () => {
  it("makes codes from the business name", () => {
    expect(newReferralCode("Kahn Prints", () => 4821)).toBe("KAHNP4821");
    expect(newReferralCode("Ọja Mama", () => 1000)).toBe("OJAMA1000");
    expect(newReferralCode("123 & co", () => 1000)).toBe("CO1000");
    expect(newReferralCode("!!", () => 1000)).toBe("SHOP1000");
  });

  it("tells the owner their code, the discount and how often it's been used", async () => {
    const text = await referralReply(setup({ code: null, until: null }).store, "b1", "Kahn Prints");
    expect(text).toContain("*KAHNP4821*");
    expect(text).toContain("*upgrade starter KAHNP4821*, and get 10% off");
    expect(text).toContain("so far: 2");
  });

  it("gives a free month of the referrer's paid plan, or of Starter", async () => {
    const pro = setup({ code: "pro", until: new Date("2026-11-20T00:00:00Z") });
    await pro.reward("KAHNP4821");
    expect(pro.extended).toEqual([["b1", "pro", 1]]);

    const lapsed = setup({ code: "pro", until: new Date("2026-10-20T00:00:00Z") });
    await lapsed.reward("KAHNP4821");
    expect(lapsed.extended).toEqual([["b1", "starter", 1]]);

    const free = setup({ code: null, until: null });
    await free.reward("KAHNP4821");
    expect(free.extended).toEqual([["b1", "starter", 1]]);
  });

  it("leaves plans that never run out, the main business and promo codes alone", async () => {
    const forever = setup({ code: "enterprise", until: null });
    expect(await forever.reward("KAHNP4821")).toBeNull();
    expect(await forever.reward("MAINS1000")).toBeNull();
    expect(await forever.reward("DAYONES")).toBeNull();
    expect(forever.extended).toEqual([]);
  });

  it("rewards the referrer once the payment goes through, without undoing the payer's plan if that fails", async () => {
    const { plans } = setup({ code: null, until: null });
    const rewarded: string[] = [];
    const payment: Payment = {
      id: "p1",
      reference: "yarnoga-quote-1",
      product: "quote",
      waId: "2348011111111",
      purpose: { businessId: "b2", plan: "starter", months: 1 },
      amountKobo: 630000,
      status: "paid",
      promoCode: "KAHNP4821",
    };
    const ok = createPlanPaidHandler({ store: plans, mainBusinessId: MAIN, rewardReferral: async (c) => rewarded.push(c) });
    await ok(payment);
    expect(rewarded).toEqual(["KAHNP4821"]);

    const failing = createPlanPaidHandler({
      store: plans,
      mainBusinessId: MAIN,
      rewardReferral: () => Promise.reject(new Error("down")),
      log: { error: () => {} },
    });
    await expect(failing(payment)).resolves.toEqual([]);
  });
});
