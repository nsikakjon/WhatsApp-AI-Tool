import { describe, expect, it } from "vitest";
import { hireCharge, settleReturn } from "./charges.js";

const DAILY = { dailyKobo: 25_000_00, weeklyKobo: null };
const WEEKLY = { dailyKobo: 25_000_00, weeklyKobo: 120_000_00 };

describe("hireCharge", () => {
  it("charges the daily rate for each day", () => {
    expect(hireCharge(3, DAILY)).toBe(75_000_00);
  });

  it("uses the weekly rate for full weeks and caps the days left over at a week", () => {
    expect(hireCharge(7, WEEKLY)).toBe(120_000_00);
    expect(hireCharge(9, WEEKLY)).toBe(120_000_00 + 50_000_00);
    // 6 days at the daily rate would be ₦150,000, more than a week.
    expect(hireCharge(6, WEEKLY)).toBe(120_000_00);
    expect(hireCharge(13, WEEKLY)).toBe(240_000_00);
  });

  it("refuses part days", () => {
    expect(() => hireCharge(0, DAILY)).toThrow();
    expect(() => hireCharge(1.5, DAILY)).toThrow();
  });
});

describe("settleReturn", () => {
  it("gives the whole deposit back when it comes back on time and undamaged", () => {
    expect(settleReturn({ depositKobo: 50_000_00, lateDays: 0, units: 1, rates: DAILY, damageKobo: 0 })).toEqual({
      lateKobo: 0,
      damageKobo: 0,
      refundKobo: 50_000_00,
      balanceKobo: 0,
    });
  });

  it("takes late days and damage off the deposit", () => {
    expect(settleReturn({ depositKobo: 100_000_00, lateDays: 1, units: 2, rates: DAILY, damageKobo: 15_000_00 })).toEqual({
      lateKobo: 50_000_00,
      damageKobo: 15_000_00,
      refundKobo: 35_000_00,
      balanceKobo: 0,
    });
  });

  it("asks for the difference when the deposit doesn't cover it", () => {
    expect(settleReturn({ depositKobo: 20_000_00, lateDays: 2, units: 1, rates: DAILY, damageKobo: 0 }).balanceKobo).toBe(30_000_00);
  });
});
