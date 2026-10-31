import { describe, expect, it, vi } from "vitest";
import type { Payment } from "../../core/payments/store.js";
import type { PlanFeatures } from "./features.js";
import { createTopUpPaidHandler, createTopUps, type AiPack, type TopUpLedger } from "./topups.js";

const OCT = () => new Date("2026-10-20T12:00:00Z");
const PACK: AiPack = { code: "ai-1000", name: "1,000 AI replies", replies: 1000, priceKobo: 200_000 };

function features(limit: number | null, included = true): PlanFeatures {
  return { planCode: async () => "free", has: async () => included, limit: async () => limit };
}

function setup(opts: { limit?: number | null; packs?: AiPack[]; used?: number; extra?: number } = {}) {
  const createLink = vi.fn(async () => ({ url: "https://checkout.paystack.com/xyz", amountKobo: 200_000, promo: null }));
  const topUps = createTopUps({
    businessId: "b2",
    features: features(opts.limit === undefined ? 500 : opts.limit),
    store: { packs: async () => opts.packs ?? [PACK], extra: async () => opts.extra ?? 0, used: async () => opts.used ?? 0 },
    links: { createLink },
    now: OCT,
    log: { error() {} },
  });
  return { topUps, createLink };
}

describe("AI reply top-ups", () => {
  it("sends a payment link for the pack, priced from the database", async () => {
    const { topUps, createLink } = setup();
    const reply = await topUps.ownerCommand("Top up", "2348011111111");
    expect(reply).toContain("1,000 extra AI replies (₦2,000)");
    expect(reply).toContain("https://checkout.paystack.com/xyz");
    expect(reply).toContain("to use by 31 October");
    expect(createLink).toHaveBeenCalledWith({
      product: "quote",
      waId: "2348011111111",
      amountKobo: 200_000,
      purpose: { kind: "ai_topup", businessId: "b2", pack: "ai-1000", replies: 1000 },
      title: "yarnOga 1,000 AI replies",
    });
  });

  it("lists the packs when there's a choice, and picks one by its number of replies", async () => {
    const big = { code: "ai-5000", name: "5,000 AI replies", replies: 5000, priceKobo: 800_000 };
    const { topUps, createLink } = setup({ packs: [PACK, big] });
    const list = await topUps.ownerCommand("topup", "234801");
    expect(list).toContain("• 5,000 replies: ₦8,000. Send *top up 5000*");
    expect(createLink).not.toHaveBeenCalled();
    expect(await topUps.ownerCommand("top up 5,000", "234801")).toContain("5,000 extra AI replies (₦8,000)");
  });

  it("leaves other messages alone, and has nothing to sell on a plan with no cap", async () => {
    expect(await setup().topUps.ownerCommand("top up the stock", "234801")).toBeNull();
    expect(await setup({ limit: null }).topUps.ownerCommand("top up", "234801")).toContain("no limit on AI replies");
    expect(await setup({ packs: [] }).topUps.ownerCommand("top up", "234801")).toContain("no AI reply packs");
  });

  it("shows the month's AI replies with any top-ups on the plan reply", async () => {
    expect(await setup({ used: 420 }).topUps.summaryLine()).toBe("AI replies this month: 420 of 500. Send *top up* for more.");
    // Menu replies after running out aren't shown as more than the allowance.
    expect(await setup({ used: 1700, extra: 1000 }).topUps.summaryLine()).toBe(
      "AI replies this month: 1,500 of 1,500 (500 on your plan + 1,000 topped up). Send *top up* for more.",
    );
    expect(await setup({ limit: null }).topUps.summaryLine()).toBeNull();
  });
});

describe("a paid top-up", () => {
  const payment: Payment = {
    id: "p1",
    reference: "yarnoga-quote-abc",
    product: "quote",
    waId: "2348011111111",
    purpose: { kind: "ai_topup", businessId: "b2", pack: "ai-1000", replies: 1000 },
    amountKobo: 200_000,
    status: "paid",
  };

  it("adds the replies to this month once, however often the payment arrives", async () => {
    const saved = new Set<string>();
    const add = vi.fn<TopUpLedger["add"]>(async (t) => (saved.has(t.reference) ? false : (saved.add(t.reference), true)));
    const paid = createTopUpPaidHandler({ ledger: { add }, planLimit: async () => 500, now: OCT });
    expect(await paid(payment)).toBe("✅ Payment of ₦2,000 received, thank you. 1,000 extra AI replies are added, to use by 31 October.");
    expect(await paid(payment)).toBeNull();
    expect(add).toHaveBeenCalledWith({
      reference: "yarnoga-quote-abc",
      businessId: "b2",
      month: "2026-10-01",
      packCode: "ai-1000",
      replies: 1000,
      amountKobo: 200_000,
      planLimit: 500,
    });
    expect(saved.size).toBe(1);
  });

  it("refuses a payment it can't read", async () => {
    const paid = createTopUpPaidHandler({ ledger: { add: async () => true }, planLimit: async () => 500 });
    await expect(paid({ ...payment, purpose: { kind: "ai_topup", businessId: "b2" } })).rejects.toThrow("can't read");
  });
});
