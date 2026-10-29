import { describe, expect, it } from "vitest";
import { promoCommand, promoRefusedText, takePromoCode, type PromoAdmin, type PromoUsage } from "./promos.js";

const isUpgrade = (t: string) => /^upgrade (standard|premium)( \d+ months?)?$/i.test(t);

describe("takePromoCode", () => {
  it("splits a code off the end only when the rest is a command", () => {
    expect(takePromoCode("upgrade standard", isUpgrade)).toEqual({ text: "upgrade standard" });
    expect(takePromoCode("upgrade standard 3 months dayones", isUpgrade)).toEqual({ text: "upgrade standard 3 months", code: "DAYONES" });
    expect(takePromoCode("upgrade premium with code KAHNP4821", isUpgrade)).toEqual({ text: "upgrade premium", code: "KAHNP4821" });
    expect(takePromoCode("upgrade premium promo code KAHNP4821", isUpgrade)).toEqual({ text: "upgrade premium", code: "KAHNP4821" });
    expect(takePromoCode("upgrade gold DAYONES", isUpgrade)).toEqual({ text: "upgrade gold DAYONES" });
  });
});

function admin(rows: PromoUsage[]): PromoAdmin {
  return {
    async codes() {
      return rows.map((r) => ({ ...r }));
    },
    async update(code, change) {
      const row = rows.find((r) => r.code === code);
      if (!row) return false;
      if (change.active !== undefined) row.active = change.active;
      if (change.maxUses !== undefined) row.maxUses = change.maxUses;
      return true;
    },
  };
}

const dayones = (): PromoUsage => ({ code: "DAYONES", percentOff: 50, maxUses: 10, active: true, product: null, used: 3, waiting: 1 });

describe("owner promo commands", () => {
  it("lists codes with how many places are left", async () => {
    const text = await promoCommand(admin([dayones()]), "promos");
    expect(text).toContain("*DAYONES*: 50% off the first month, on. 3 of 10 used, 6 left (1 more holding an unpaid link).");
  });

  it("switches a code off and on, and changes its limit", async () => {
    const rows = [dayones()];
    expect(await promoCommand(admin(rows), "promo dayones off")).toContain("OFF");
    expect(rows[0]!.active).toBe(false);
    expect(await promoCommand(admin(rows), "Promo DAYONES limit 20")).toContain("3 of 20 used, 16 left");
    expect(await promoCommand(admin(rows), "promo DAYONES limit none")).toContain("3 used, no limit");
    expect(rows[0]).toMatchObject({ maxUses: null, active: false });
    expect(await promoCommand(admin(rows), "promo DAYONES on")).toContain(", on.");
  });

  it("explains itself for unknown codes and half-typed commands, and ignores everything else", async () => {
    expect(await promoCommand(admin([]), "promo NEWYEAR off")).toContain("no promo code called NEWYEAR");
    expect(await promoCommand(admin([]), "promo DAYONES")).toContain("promo DAYONES limit 20");
    expect(await promoCommand(admin([]), "set plan standard for X")).toBeNull();
  });
});

describe("refusals", () => {
  it("says why a code can't be used", () => {
    expect(promoRefusedText({ result: "full", code: "DAYONES", maxUses: 10 })).toContain("first 10 subscribers");
    expect(promoRefusedText({ result: "own", code: "KAHNP4821", maxUses: null })).toContain("your own referral code");
    expect(promoRefusedText({ result: "unknown", code: "X1234", maxUses: null })).toContain("without the code to pay the full price");
  });
});
