import { describe, expect, it } from "vitest";
import { summariseShopCosts, type ShopCostInputs } from "./costs.js";
import { renderDashboard } from "./page.js";
import { sampleStats } from "./testing.js";

// Midday on 16 October in Lagos: exactly half of the month gone.
const HALF_WAY = new Date("2026-10-16T11:00:00Z");

const use = (business_number_id: string, ai_micro_usd: number, voice_micro_usd = 0, voice_seconds = 0) => ({
  business_number_id,
  ai_replies: ai_micro_usd ? 10 : 0,
  ai_micro_usd,
  voice_notes: voice_seconds ? 1 : 0,
  voice_seconds,
  voice_micro_usd,
});

function inputs(): ShopCostInputs {
  return {
    usage: [use("MAIN", 2_000_000), use("ADA", 100_000), use("BRANCH", 0, 50_000, 600), use("FLY", 10_000)],
    sent: [
      { business_number_id: "MAIN", sent: 1500 },
      { business_number_id: "", sent: 100 },
      { business_number_id: "OWN", sent: 5000 },
    ],
    businesses: [
      { id: "b1", name: "KahnPrints", phone_number_id: null, plan_code: null, plan_paid_until: null, active: true },
      { id: "ada", name: "Ada Prints", phone_number_id: "ADA", plan_code: "pro", plan_paid_until: "2026-10-01T00:00:00Z", active: true },
      { id: "br", name: "Ada Prints Ikeja", phone_number_id: "BRANCH", plan_code: null, plan_paid_until: null, branch_of: "ada", active: true },
      { id: "bola", name: "Bola Bakes", phone_number_id: "OWN", plan_code: "pro", plan_paid_until: null, active: true },
      { id: "gone", name: "Closed Shop", phone_number_id: "GONE", plan_code: null, plan_paid_until: null, active: false },
    ],
    plans: [
      { code: "free", name: "Free", monthly_price_kobo: 0 },
      { code: "starter", name: "Starter", monthly_price_kobo: 700000 },
      { code: "pro", name: "Pro", monthly_price_kobo: 2300000 },
    ],
    ownAccounts: ["OWN"],
    numbers: [
      { id: "MAIN", label: "Sales" },
      { id: "FLY", label: "Flyers" },
    ],
    mainBusiness: { id: "b1", plan: "starter" },
    usdRateKobo: 150000,
  };
}

describe("cost to serve each shop", () => {
  const costs = summariseShopCosts(inputs(), HALF_WAY);

  it("adds AI, voice notes and Meta's fee past the free 1,000 messages, in naira at the ledger's dollar rate", () => {
    const kahn = costs.shops.find((s) => s.name === "KahnPrints")!;
    // $2 of AI = ₦3,000; 600 messages past the free 1,000 (unlabelled ones are the main number's) x $0.0067 = ₦6,030
    expect(kahn.cost).toEqual({ aiKobo: 300000, voiceKobo: 0, metaKobo: 603000, totalKobo: 903000 });
    expect(kahn).toMatchObject({ plan: "Starter", paysKobo: 700000, sent: 1600 });
  });

  it("projects the month at this pace, flags shops that will cost more than they pay, and shows the worst first", () => {
    // Half the month gone: AI doubles; 3,200 messages means 2,200 past the free 1,000.
    expect(costs.shops[0]).toMatchObject({ name: "KahnPrints", projectedKobo: 2811000, losing: true });
    expect(costs.shops.map((s) => s.name)).toEqual(["KahnPrints", "Ada Prints", "Bola Bakes"]);
  });

  it("counts a branch under its main business and treats a lapsed plan as Free", () => {
    const ada = costs.shops.find((s) => s.name === "Ada Prints")!;
    expect(ada).toMatchObject({ plan: "Free", paysKobo: 0, voiceNotes: 1, voiceMinutes: 10, losing: true });
    expect(ada.cost).toMatchObject({ aiKobo: 15000, voiceKobo: 7500 });
  });

  it("charges no Meta fee on a number the business connected itself", () => {
    expect(costs.shops.find((s) => s.name === "Bola Bakes")).toMatchObject({ sent: 5000, projectedKobo: 0, losing: false });
  });

  it("totals each plan and keeps our own numbers apart from the shops", () => {
    expect(costs.plans).toEqual([
      { plan: "Free", shops: 1, paysKobo: 0, projectedKobo: 45000, losing: true },
      { plan: "Starter", shops: 1, paysKobo: 700000, projectedKobo: 2811000, losing: true },
      { plan: "Pro", shops: 1, paysKobo: 2300000, projectedKobo: 0, losing: false },
    ]);
    expect(costs.otherNumbers).toEqual([expect.objectContaining({ name: "Flyers", cost: expect.objectContaining({ aiKobo: 1500 }) })]);
  });

  it("shows on the dashboard with the loss-making shops and plans flagged", () => {
    const html = renderDashboard(sampleStats(), [], undefined, undefined, costs);
    expect(html).toContain('href="#costs"');
    expect(html).toContain("Cost to serve each shop");
    expect(html).toContain("Loses money");
    expect(html).toMatch(/Paid plans losing money<\/div><div class="value">1</);
    expect(html).toContain("₦1,500 to $1");
  });

  it("says what to do when the costs can't load, and stays hidden when switched off", () => {
    expect(renderDashboard(sampleStats(), [], undefined, undefined, "error")).toContain("migration 0065");
    expect(renderDashboard(sampleStats())).not.toContain('id="costs"');
  });
});
