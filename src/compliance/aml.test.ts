import { describe, expect, it } from "vitest";
import { bankMatches, liftsLimits, nameTokens, namesMatch, unusualPayments, type PaidPayment } from "./aml.js";
import { blankVerification } from "./store.js";

const NOW = new Date("2026-11-14T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const pay = (amountKobo: number, daysAgo: number, waId = "2348011111111"): PaidPayment => ({ amountKobo, paidAt: ago(daysAgo), waId });

describe("names", () => {
  it("keeps only the words that identify someone", () => {
    expect(nameTokens("Kahn Prints & Designs Ltd.")).toEqual(["kahn", "prints", "designs"]);
    expect(nameTokens("Alhaji Musa Bello")).toEqual(["musa", "bello"]);
  });

  it("matches a bank's name for an account in any order, but not a different person", () => {
    expect(namesMatch("OKAFOR ADA CHIOMA", "Ada Okafor")).toBe(true);
    expect(namesMatch("KAHN PRINTS AND DESIGNS", "Kahn Prints Ltd")).toBe(true);
    expect(namesMatch("ADA BELLO", "Ada Okafor")).toBe(false);
    expect(namesMatch("", "Ada Okafor")).toBe(false);
  });

  it("accepts an account in the business's name or the owner's", () => {
    const v = { registeredName: "Kemi's Cakes", directorName: "Kemi Adebayo" };
    expect(bankMatches("ADEBAYO KEMI FOLAKE", v)).toBe(true);
    expect(bankMatches("KEMIS CAKES", v)).toBe(true);
    expect(bankMatches("JOHN DOE", v)).toBe(false);
  });
});

describe("lifting the limits", () => {
  const approved = { ...blankVerification("b1"), status: "approved" as const, registeredName: "Kahn Prints", directorName: "Ada Okafor" };
  it("needs approval, no pause, and money going to an account in the verified name", () => {
    expect(liftsLimits(approved, "KAHN PRINTS")).toBe(true);
    expect(liftsLimits(approved, null)).toBe(true);
    expect(liftsLimits(approved, "JOHN DOE")).toBe(false);
    expect(liftsLimits({ ...approved, paused: true }, "KAHN PRINTS")).toBe(false);
    expect(liftsLimits({ ...approved, status: "submitted" }, "KAHN PRINTS")).toBe(false);
  });
});

describe("unusual payments", () => {
  const codes = (paid: PaidPayment[], verified = false) => unusualPayments(paid, NOW, { currency: "NGN", verified }).map((f) => f.code);

  it("flags nothing for a shop's ordinary sales", () => {
    const usual = Array.from({ length: 30 }, (_, i) => pay(1_500_000, i + 0.5, `23480${i}`));
    expect(codes(usual)).toEqual([]);
  });

  it("flags a single payment of ₦5m or more", () => {
    expect(codes([pay(500_000_000, 0.2)], true)).toEqual(["big", "jump"]);
  });

  it("flags payments kept just under the limit, only while unverified", () => {
    const split = [pay(19_500_000, 1, "a"), pay(19_900_000, 2, "b"), pay(18_000_000, 3, "c")];
    expect(codes(split)).toContain("near_limit");
    expect(codes(split, true)).not.toContain("near_limit");
  });

  it("flags one customer paying five times in a day", () => {
    expect(codes(Array.from({ length: 5 }, () => pay(100_000, 0.1)))).toEqual(["same_payer"]);
  });

  it("flags a week far above the shop's usual week", () => {
    const before = Array.from({ length: 8 }, (_, i) => pay(2_000_000, 8 + i * 3, `x${i}`));
    const week = Array.from({ length: 6 }, (_, i) => pay(15_000_000, i, `y${i}`));
    expect(codes([...before, ...week])).toEqual(["jump"]);
    expect(codes(week.slice(0, 2))).toEqual([]);
  });
});
