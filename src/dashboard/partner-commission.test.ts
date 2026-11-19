import { describe, expect, it } from "vitest";
import { commissionState, parseCommissionForm, renderCommission, workOutCommission } from "./partner-commission.js";
import type { Partner } from "./partners.js";

const shop = (id: string, name: string) => ({ id, name, planCode: "pro" });

describe("workOutCommission", () => {
  it("pays a share of each shop's plan payments for its first 12 months only", () => {
    const c = workOutCommission(25, 0, [shop("a", "Mama Put")], [
      { businessId: "a", amountKobo: 2_070_000, paidAt: "2026-11-21T10:00:00Z" },
      { businessId: "a", amountKobo: 2_300_000, paidAt: "2027-11-20T10:00:00Z" },
      { businessId: "a", amountKobo: 2_300_000, paidAt: "2027-11-21T10:00:00Z" },
    ]);
    expect(c.rows[0]!.paidKobo).toBe(4_370_000);
    expect(c.earnedKobo).toBe(1_092_500);
    expect(c.rows[0]!.until).toBe("2027-11-20");
  });

  it("ignores other shops' payments, lists shops that haven't paid, and rounds down to the kobo", () => {
    const c = workOutCommission(25, 0, [shop("a", "A"), shop("b", "B")], [
      { businessId: "a", amountKobo: 333, paidAt: "2026-11-21T10:00:00Z" },
      { businessId: "z", amountKobo: 9_000_000, paidAt: "2026-11-21T10:00:00Z" },
    ]);
    expect(c.earnedKobo).toBe(83);
    expect(c.rows.map((r) => [r.shop.id, r.until])).toEqual([["a", "2027-11-20"], ["b", null]]);
  });

  it("shows what's still owed once some has been paid out", () => {
    const c = workOutCommission(25, 500_000, [shop("a", "A")], [{ businessId: "a", amountKobo: 2_300_000, paidAt: "2026-11-21T10:00:00Z" }]);
    expect(commissionState(c)).toBe("₦750 owed");
  });
});

describe("parseCommissionForm", () => {
  it("reads the share and what's been paid", () => {
    expect(parseCommissionForm({ commission_percent: "25", paid_out: "5,750" })).toEqual({ percent: 25, paidOutKobo: 575_000 });
    expect(parseCommissionForm({ commission_percent: "", paid_out: "" })).toEqual({ percent: null, paidOutKobo: 0 });
    expect(parseCommissionForm({ commission_percent: "0" })).toHaveProperty("problem");
    expect(parseCommissionForm({ commission_percent: "25", paid_out: "5k" })).toHaveProperty("problem");
  });
});

describe("renderCommission", () => {
  const p = { id: 7, name: "Prosper", promoCode: "PROSPER", status: "Agreed" } as Partner;
  it("lists the shops and what's owed", () => {
    const html = renderCommission(p, workOutCommission(25, 0, [shop("a", "Mama <Put>")], [{ businessId: "a", amountKobo: 2_300_000, paidAt: "2026-11-21T10:00:00Z" }]));
    expect(html).toContain("Mama &#60;Put&#62;");
    expect(html).toContain("₦5,750 still owed");
    expect(html).toContain('action="/dashboard/partners/7/commission"');
  });
  it("says when nobody has signed up with the code yet", () => {
    expect(renderCommission(p, workOutCommission(25, 0, [], []))).toContain("No shop has signed up with PROSPER yet");
  });
});
