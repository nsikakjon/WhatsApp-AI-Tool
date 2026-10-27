import { describe, expect, it } from "vitest";
import { dailySummary, lagosDate, lagosDayStart, SUMMARY_SEEN } from "./summary.js";
import type { AppBusiness } from "./types.js";

const NOW = new Date("2026-10-27T07:05:00Z"); // 08:05 in Lagos

function biz(over: { orders?: number; paid?: number; unpaid?: number[]; stock?: number | null } = {}): AppBusiness {
  return {
    name: "KahnPrints",
    currency: "NGN",
    board: {
      sales: async () => ({ quotes: 5, orders: over.orders ?? 3, paidInKobo: over.paid ?? 4_500_000 }),
      orders: async () => (over.unpaid ?? [1_000_000]).map((totalKobo, i) => ({ id: `o${i}`, status: "confirmed", totalKobo })),
    },
    data: { topItems: async () => [{ name: "Flyers: A5", quantity: 500, totalKobo: 5_000_000 }] },
    prices: { products: async () => [{ name: "Mugs", options: [{ name: "Standard", stock: over.stock === undefined ? 3 : over.stock }] }] },
  } as unknown as AppBusiness;
}

describe("morning summary", () => {
  it("sums up yesterday, what's unpaid and what's running low, with a Got it button", async () => {
    const s = (await dailySummary(biz(), NOW, "https://app.yarnoga.com"))!;
    expect(s.text).toContain("Yesterday at *KahnPrints*");
    expect(s.text).toContain("• Orders: 3 (from 5 quotes)");
    expect(s.text).toContain("• Paid in: ₦45,000");
    expect(s.text).toContain("• Best seller: Flyers: A5 (500)");
    expect(s.text).toContain("Waiting for payment: 1 order, ₦10,000");
    expect(s.text).toContain("• Mugs: 3 left");
    expect(s.text).toContain("https://app.yarnoga.com/app");
    expect(s.buttons.buttons[0]).toEqual({ id: SUMMARY_SEEN, title: "Got it ✅" });
  });

  it("stays quiet on a day with nothing to say", async () => {
    expect(await dailySummary(biz({ orders: 0, paid: 0, unpaid: [], stock: null }), NOW)).toBeNull();
  });

  it("works in Lagos days", () => {
    expect(lagosDayStart(NOW, 1).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(lagosDate(new Date("2026-10-26T23:30:00Z"))).toBe("2026-10-27");
  });
});
