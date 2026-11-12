import { describe, expect, it, vi } from "vitest";
import type { Payment } from "../../core/payments/store.js";
import type { PlanFeatures } from "./features.js";
import { createFlyerAllowance, createFlyerPackPaidHandler, type FlyerStore } from "./flyer-packs.js";

const quiet = { error() {} };
const plan = (limit: number | null): PlanFeatures => ({ planCode: async () => "free", has: async () => true, limit: async () => limit });

function memory(bought = 0) {
  const made: Array<{ paidBy: "plan" | "pack"; at: Date }> = [];
  const store: FlyerStore = {
    packs: async () => [{ code: "flyers-10", name: "10 flyers", flyers: 10, priceKobo: 100000 }],
    bought: async () => bought,
    madeFromPacks: async () => made.filter((m) => m.paidBy === "pack").length,
    madeOnPlan: async (since) => made.filter((m) => m.paidBy === "plan" && m.at >= since).length,
    record: async (paidBy) => void made.push({ paidBy, at: new Date("2026-11-12T10:00:00Z") }),
  };
  return { store, made };
}
const now = () => new Date("2026-11-12T10:00:00Z");

describe("flyer allowance", () => {
  it("gives a limited plan its flyers for the month, then none", async () => {
    const m = memory();
    const a = createFlyerAllowance({ businessId: "b", features: plan(2), store: m.store, now });
    expect(await a.status()).toEqual({ planLimit: 2, planLeft: 2, packLeft: 0 });
    expect(await a.use()).toBe("plan");
    expect(await a.use()).toBe("plan");
    expect(await a.use()).toBeNull();
    // Last month's flyers don't count.
    m.made.forEach((x) => (x.at = new Date("2026-10-30T10:00:00Z")));
    expect((await a.status()).planLeft).toBe(2);
  });

  it("uses a pack before the plan's flyers, and packs carry over months", async () => {
    const m = memory(1);
    const a = createFlyerAllowance({ businessId: "b", features: plan(5), store: m.store, now });
    expect(await a.use()).toBe("pack");
    expect(await a.use()).toBe("plan");
    expect(await a.status()).toEqual({ planLimit: 5, planLeft: 4, packLeft: 0 });
  });

  it("has no limit on a plan without one, or when the count can't be read", async () => {
    const m = memory();
    const open = createFlyerAllowance({ businessId: "b", features: plan(null), store: m.store, now });
    expect(await open.use()).toBe("plan");
    expect(m.made).toHaveLength(0);
    const broken = createFlyerAllowance({ businessId: "b", features: plan(5), store: { ...m.store, bought: async () => Promise.reject(new Error("no table")) }, now, log: quiet });
    expect((await broken.status()).planLimit).toBeNull();
  });

  it("sells packs by payment link, priced from the pack's row", async () => {
    const createLink = vi.fn(async () => ({ url: "https://pay.example/x", reference: "r" }));
    const a = createFlyerAllowance({ businessId: "b", features: plan(5), store: memory().store, links: { createLink } as never, now });
    expect(await a.link("flyers-10", "2348011111111")).toBe("https://pay.example/x");
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 100000, purpose: { kind: "flyer_pack", businessId: "b", pack: "flyers-10", flyers: 10 } }));
    expect(await a.link("nope", "2348011111111")).toBeNull();
    // No payments (or not a naira business): nothing on sale.
    expect(await createFlyerAllowance({ businessId: "b", features: plan(5), store: memory().store, now }).packs()).toEqual([]);
  });

  it("adds a paid pack once, however often the webhook comes", async () => {
    const seen = new Set<string>();
    const paid = createFlyerPackPaidHandler({ add: async (t) => !seen.has(t.reference) && Boolean(seen.add(t.reference)) });
    const payment = { reference: "ref-1", amountKobo: 100000, purpose: { kind: "flyer_pack", businessId: "b", pack: "flyers-10", flyers: 10 } } as unknown as Payment;
    expect(await paid(payment)).toContain("10 flyers are added");
    expect(await paid(payment)).toBeNull();
    await expect(paid({ ...payment, purpose: { kind: "flyer_pack" } } as unknown as Payment)).rejects.toThrow("can't read");
  });
});
