import { describe, expect, it } from "vitest";
import { assertKobo, formatNaira } from "./money.js";

describe("formatNaira", () => {
  it("shows whole naira with thousands separators", () => {
    expect(formatNaira(0)).toBe("₦0");
    expect(formatNaira(50_000)).toBe("₦500");
    expect(formatNaira(1_250_000)).toBe("₦12,500");
    expect(formatNaira(123_456_700)).toBe("₦1,234,567");
  });

  it("shows kobo only when there are some", () => {
    expect(formatNaira(1_250_050)).toBe("₦12,500.50");
    expect(formatNaira(5)).toBe("₦0.05");
  });

  it("refuses fractions and negatives", () => {
    expect(() => formatNaira(10.5)).toThrow();
    expect(() => formatNaira(-100)).toThrow();
  });
});

describe("assertKobo", () => {
  it("passes whole amounts through", () => {
    expect(assertKobo(1234)).toBe(1234);
  });
  it("rejects non-integers", () => {
    expect(() => assertKobo(Number.NaN)).toThrow();
    expect(() => assertKobo(0.1 + 0.2)).toThrow();
  });
});
