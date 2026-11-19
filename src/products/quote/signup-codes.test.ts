import { describe, expect, it } from "vitest";
import { codeKept, findCode, type SignupCode } from "./signup-codes.js";

const CODES: SignupCode[] = [
  { code: "TEDXUNIUYO", percentOff: 70, maxUses: 200, endsOn: "2027-01-31", personal: false },
  { code: "DAYONES", percentOff: 50, maxUses: 10, endsOn: null, personal: false },
  { code: "KAHNP4821", percentOff: 10, maxUses: null, endsOn: null, personal: true },
];

describe("finding a code in what was typed", () => {
  it.each([
    ["TEDXUNIUYO is the referral code", "TEDXUNIUYO"],
    ["The referral code TEDxUNIU", "TEDXUNIUYO"],
    ["tedx uniuyo", "TEDXUNIUYO"],
    ["my code is TEDXUNIYO", "TEDXUNIUYO"],
    ["dayones", "DAYONES"],
    ["kahnp 4821", "KAHNP4821"],
  ])("%s", (text, code) => {
    expect(findCode(text, CODES)?.code).toBe(code);
  });

  it("needs a business's own referral code exactly, and ignores ordinary words", () => {
    expect(findCode("KAHNP482", CODES)).toBeNull();
    expect(findCode("I don't have a referral code", CODES)).toBeNull();
    expect(findCode("We sell turkey and bread", CODES)).toBeNull();
  });

  it("says what the code gives, from its own settings", () => {
    expect(codeKept(CODES[0]!)).toBe(
      "Thanks, I've added your code *TEDXUNIUYO*. It gives you 70% off your first month on any paid plan, for the first 200 businesses, if you upgrade by 31 Jan 2027. " +
        "You start on the Free plan, and the discount comes off automatically when you upgrade.",
    );
  });
});
