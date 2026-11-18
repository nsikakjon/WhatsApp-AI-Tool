import { describe, expect, it } from "vitest";
import type { ProductRecord } from "../store.js";
import { growth, lapsedCustomers, postItems, priceCheck, shopHealth, type AdvisorData, type AdvisorOrder } from "./numbers.js";

const NOW = new Date("2026-11-18T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function order(customerId: string, ago: number, totalKobo: number, opts: { paid?: boolean; lines?: AdvisorOrder["lines"] } = {}): AdvisorOrder {
  return {
    customerId,
    name: `Customer ${customerId}`,
    waId: `23480300000${customerId}`,
    confirmedAt: daysAgo(ago),
    paidAt: opts.paid === false ? null : daysAgo(ago),
    totalKobo,
    lines: opts.lines ?? [{ variantId: "v-a5", name: "Flyers: A5", quantity: 100, totalKobo, unitCostKobo: null }],
  };
}

const products: ProductRecord[] = [
  {
    id: "p-flyers",
    name: "Flyers",
    description: null,
    category: null,
    unit: null,
    leadTimeDays: null,
    active: true,
    photoPath: null,
    morePhotos: [],
    options: [
      {
        id: "v-a5",
        name: "A5",
        minQuantity: 50,
        stock: null,
        costKobo: 60,
        tiers: [
          { minQuantity: 50, unitPriceKobo: 100 },
          { minQuantity: 1000, unitPriceKobo: 50 },
        ],
      },
    ],
  },
  {
    id: "p-mugs",
    name: "Mugs",
    description: null,
    category: null,
    unit: null,
    leadTimeDays: null,
    active: true,
    photoPath: null,
    morePhotos: [],
    options: [{ id: "v-mug", name: "White", minQuantity: 1, stock: 5, costKobo: null, tiers: [{ minQuantity: 1, unitPriceKobo: 250_000 }] }],
  },
];

describe("business advisor figures", () => {
  it("compares the last 30 days with the 30 before", () => {
    const data: AdvisorData = {
      orders: [order("1", 5, 10_000), order("1", 40, 20_000), order("2", 10, 30_000, { paid: false }), order("3", 45, 5_000)],
      counter: [{ at: daysAgo(2), totalKobo: 2_000, lines: [] }],
      products,
    };
    const { recent, before } = shopHealth(data, NOW);
    expect(recent).toEqual({ salesKobo: 12_000, orders: 3, averageKobo: 14_000, customers: 2, repeat: 1, unpaid: 1, unpaidKobo: 30_000 });
    expect(before).toEqual({ salesKobo: 25_000, orders: 2, averageKobo: 12_500, customers: 2, repeat: 0, unpaid: 0, unpaidKobo: 0 });
  });

  it("finds regular customers who went quiet, biggest spenders first", () => {
    const data: AdvisorData = {
      orders: [order("1", 40, 10_000), order("1", 80, 10_000), order("2", 35, 50_000), order("2", 90, 50_000), order("3", 5, 1_000), order("3", 50, 1_000), order("4", 60, 99_000)],
      counter: [],
      products,
    };
    expect(lapsedCustomers(data, NOW).map((c) => [c.waId.slice(-1), c.orders, c.spentKobo])).toEqual([
      ["2", 2, 100_000],
      ["1", 2, 20_000],
    ]);
  });

  it("names best sellers, items nobody bought and the busiest weekdays", () => {
    const data: AdvisorData = {
      orders: [order("1", 1, 10_000), order("2", 8, 5_000)],
      counter: [{ at: daysAgo(1), totalKobo: 3_000, lines: [{ name: "Flyers: A5", quantity: 30, totalKobo: 3_000, unitCostKobo: 60 }] }],
      products,
    };
    const g = growth(data, NOW);
    expect(g.best).toEqual([{ name: "Flyers", quantity: 230, totalKobo: 18_000 }]);
    expect(g.slow).toEqual(["Mugs"]);
    // 17 Nov 2026 is a Tuesday in Lagos, 10 Nov too.
    expect(g.days).toEqual([0, 3, 0, 0, 0, 0, 0]);
  });

  it("checks prices against cost and bulk prices nobody reaches", () => {
    const data: AdvisorData = {
      orders: [order("1", 3, 5_000, { lines: [{ variantId: "v-a5", name: "Flyers: A5", quantity: 100, totalKobo: 5_000, unitCostKobo: 60 }] })],
      counter: [],
      products,
    };
    const p = priceCheck(data, NOW);
    expect(p.costsOn).toBe(true);
    expect(p.belowCost).toEqual([{ name: "Flyers: A5", fromQuantity: 1000, priceKobo: 50, costKobo: 60 }]);
    expect(p.soldBelowCost).toEqual([{ name: "Flyers: A5", times: 1, lossKobo: 1_000 }]);
    expect(p.unusedTiers).toEqual([{ name: "Flyers: A5", fromQuantity: 1000, biggest: 100 }]);
    expect(p.noCost).toBe(1);
  });

  it("says when cost prices can't be read", () => {
    const noCosts = products.map((p) => ({ ...p, options: p.options.map(({ costKobo: _, ...o }) => o) }));
    expect(priceCheck({ orders: [], counter: [], products: noCosts }, NOW)).toMatchObject({ costsOn: false, belowCost: [], noCost: 0 });
  });

  it("puts best sellers in the post with their lowest list price, or the price list when nothing sold", () => {
    expect(postItems({ orders: [order("1", 2, 10_000)], counter: [], products }, NOW)).toEqual({ items: [{ name: "Flyers", fromKobo: 50 }], fromSales: true });
    expect(postItems({ orders: [], counter: [], products }, NOW)).toEqual({
      items: [
        { name: "Flyers", fromKobo: 50 },
        { name: "Mugs", fromKobo: 250_000 },
      ],
      fromSales: false,
    });
  });
});
