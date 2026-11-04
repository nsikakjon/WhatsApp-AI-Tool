import { describe, expect, it } from "vitest";
import { lockToPlan } from "./plan-locks.js";
import type { AppBusiness } from "./types.js";
import type { PlanFeature, PlanFeatures } from "../products/quote/features.js";

const plan = (off: PlanFeature[]): PlanFeatures => ({
  planCode: async () => "starter",
  has: async (f) => !off.includes(f),
  limit: async () => null,
});

const sellOffline = async () => ({ ok: true as const, saleId: "s1", duplicate: false });
const biz = (features?: PlanFeatures) =>
  ({
    features,
    barcodes: true,
    counter: { sell: async () => ({ ok: true }), sellOffline },
    tax: {},
    payouts: {},
    monthly: {},
    ads: {},
  }) as unknown as AppBusiness;

describe("lockToPlan", () => {
  it("leaves a business with no plan as it is", async () => {
    const b = biz();
    expect(await lockToPlan(b)).toBe(b);
  });

  it("keeps everything the plan includes", async () => {
    const b = await lockToPlan(biz(plan([])));
    expect(b.barcodes).toBe(true);
    expect(b.counter?.sellOffline).toBe(sellOffline);
    expect(b.staffLogins).toBe(true);
    expect(b.tax && b.payouts && b.monthly && b.ads).toBeTruthy();
  });

  it("turns off what a Starter plan leaves out, but keeps counter sales", async () => {
    const b = await lockToPlan(biz(plan(["payouts", "monthly_payments", "ad_leads"])));
    expect(b.payouts).toBeUndefined();
    expect(b.monthly).toBeUndefined();
    expect(b.ads).toBeUndefined();
    expect(b.tax).toBeTruthy();
    expect(b.barcodes).toBe(true);
  });

  it("on Free, hides barcodes, the offline till, tax and staff logins", async () => {
    const b = await lockToPlan(biz(plan(["barcodes", "offline_till", "tax_summary", "staff_roles", "payouts", "monthly_payments", "ad_leads"])));
    expect(b.barcodes).toBe(false);
    expect(b.counter).toBeTruthy();
    expect(b.counter?.sellOffline).toBeUndefined();
    expect(b.tax).toBeUndefined();
    expect(b.staffLogins).toBe(false);
  });
});
