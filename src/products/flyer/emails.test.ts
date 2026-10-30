import { describe, expect, it } from "vitest";
import { renderEmail } from "../../core/email/layout.js";
import { flyerEmails, type FlyerEmailFacts } from "./emails.js";

const facts: FlyerEmailFacts = {
  live: true,
  group: "Unilag Class of 2010",
  members: 4,
  memberLimit: 50,
  trialEnds: new Date("2026-11-04T10:00:00Z"),
  prices: {
    standard: { monthly: 450_000, yearly: 250_000, from: null },
    premium: { monthly: 800_000, yearly: 650_000, from: null },
    deluxe: { monthly: 1_000_000, yearly: 850_000, from: null },
    organisation: { monthly: null, yearly: null, from: 7_300_000 },
  },
};
const series = flyerEmails(async () => facts);
const text = (key: string, f = facts) =>
  renderEmail(series.emails.find((e) => e.key === key)!.content(f, "Nsikak"), { imageBase: "https://i", unsubscribeUrl: "https://u" }).text;

describe("flyer emails", () => {
  it("has the seven approved emails and the text-fix guide in day order", () => {
    expect(series.emails.map((e) => `${e.key}:${e.day}`)).toEqual(["F1:0", "F2:1", "F3:3", "F8:4", "F4:5", "F7:6", "F5:7", "F6:10"]);
  });

  it("fills in every email without gaps", () => {
    for (const e of series.emails) expect(text(e.key), e.key).not.toMatch(/undefined|null|NaN|\{/);
  });

  it("gives the plans with prices from the database", () => {
    const plans = text("F7");
    expect(plans).toContain("Your free Standard trial ends on 4 November.");
    expect(plans).toContain("Standard: ₦4,500 a month, or ₦2,500 a month paid yearly. Up to 50 members.");
    expect(plans).toContain("Organisation: from ₦73,000 a month");
  });

  it("sends the plans email on a trial or near the member limit", () => {
    const when = series.emails.find((e) => e.key === "F7")!.when!;
    expect(when(facts)).toBe(true);
    expect(when({ ...facts, trialEnds: null, members: 4, memberLimit: 10 })).toBe(false);
    expect(when({ ...facts, trialEnds: null, members: 9, memberLimit: 10 })).toBe(true);
    expect(text("F7", { ...facts, trialEnds: null, members: 9, memberLimit: 10 })).toContain("has 9 members, close to the 10 on your plan");
  });
});
