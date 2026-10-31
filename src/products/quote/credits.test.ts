import { describe, expect, it } from "vitest";
import { createAiCredits, lagosMonthKey } from "./credits.js";
import type { PlanFeatures } from "./features.js";

function features(limit: number | null, included = true): PlanFeatures {
  return { planCode: async () => "free", has: async () => included, limit: async () => limit };
}

function counter(start = 0) {
  let used = start;
  const months: string[] = [];
  return { months, use: async (month: string) => (months.push(month), ++used) };
}

describe("AI credits", () => {
  it("counts by Lagos month", () => {
    expect(lagosMonthKey(new Date("2026-10-16T12:00:00Z"))).toBe("2026-10-01");
    expect(lagosMonthKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });

  it("uses the AI up to the limit, warns at 80% and when they run out", async () => {
    const store = counter(7);
    const credits = createAiCredits({ features: features(10), store, now: () => new Date("2026-10-16T12:00:00Z") });
    const warn = await credits.spend(); // 8 of 10
    expect(warn.useAi).toBe(true);
    expect(warn.ownerNotice).toContain("used 8 of your 10 AI replies");
    expect(store.months[0]).toBe("2026-10-01");
    expect(await credits.spend()).toEqual({ useAi: true, ownerNotice: null }); // 9
    expect(await credits.spend()).toEqual({ useAi: true, ownerNotice: null }); // 10
    const out = await credits.spend(); // 11
    expect(out.useAi).toBe(false);
    expect(out.ownerNotice).toContain("used all 10 AI replies");
    expect(out.usedUp).toBe(true);
    expect(await credits.spend()).toEqual({ useAi: false, ownerNotice: null }); // 12: told once
  });

  it("adds replies bought this month to the plan's, and points the owner to top-ups", async () => {
    const store = counter(9);
    const credits = createAiCredits({ features: features(10), store, topUps: { extra: async () => 5 } });
    expect((await credits.spend()).useAi).toBe(true); // 10 of 15
    for (let i = 0; i < 5; i++) await credits.spend(); // up to 15
    const out = await credits.spend(); // 16
    expect(out.useAi).toBe(false);
    expect(out.ownerNotice).toContain("used all 15 AI replies");
    expect(out.ownerNotice).toContain("Send *top up* to buy more replies");
  });

  it("doesn't count when the plan has no cap", async () => {
    const store = counter();
    expect(await createAiCredits({ features: features(null), store }).spend()).toEqual({ useAi: true, ownerNotice: null });
    expect(store.months).toHaveLength(0);
  });

  it("gives no AI when the plan doesn't include it", async () => {
    expect((await createAiCredits({ features: features(null, false), store: counter() }).spend()).useAi).toBe(false);
  });

  it("keeps the AI on when the count fails", async () => {
    const broken = { use: async () => Promise.reject(new Error("down")) };
    expect(await createAiCredits({ features: features(10), store: broken, log: { error() {} } }).spend()).toEqual({ useAi: true, ownerNotice: null });
  });
});
