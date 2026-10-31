import { describe, expect, it } from "vitest";
import { guessLanguage } from "./i18n.js";
import { assertKobo, formatMoney, formatNaira, formatPayMoney, parseMoney, payCurrencyFor } from "./money.js";

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


describe("currencies", () => {
  it("writes CFA francs the French way and naira as before", () => {
    expect(formatMoney(500000, "XOF")).toBe("5 000 FCFA");
    expect(formatMoney(14200000, "XAF")).toBe("142 000 FCFA");
    expect(formatMoney(1250050, "NGN")).toBe("₦12,500.50");
  });

  it("reads prices typed in either currency, CFA in whole francs only", () => {
    expect(parseMoney("5 000", "XOF")).toBe(500000);
    expect(parseMoney("5.000 FCFA", "XOF")).toBe(500000);
    expect(parseMoney("3500F", "XAF")).toBe(350000);
    expect(parseMoney("15k", "XOF")).toBeNull();
    expect(parseMoney("₦1,500.50", "NGN")).toBe(150050);
  });
});

describe("plan payment currencies", () => {
  it("goes by the country of the WhatsApp number", () => {
    expect(payCurrencyFor("2348024777076")).toBe("NGN");
    expect(payCurrencyFor("233241234567")).toBe("GHS");
    expect(payCurrencyFor("254712345678")).toBe("KES");
    expect(payCurrencyFor("2250701234567")).toBe("XOF");
    expect(payCurrencyFor("237612345678")).toBe("XAF");
    expect(payCurrencyFor("447700900123")).toBe("USD");
  });

  it("formats each currency the way people write it", () => {
    expect(formatPayMoney(700_000, "NGN")).toBe("₦7,000");
    expect(formatPayMoney(350_000, "XOF")).toBe(formatMoney(350_000, "XOF"));
    expect(formatPayMoney(298_000, "GHS")).toBe("GH₵2,980");
    expect(formatPayMoney(85_000, "KES")).toBe("KSh 850");
    expect(formatPayMoney(550, "USD")).toBe("$5.50");
  });
});

describe("guessLanguage", () => {
  it("spots French and English, and gives up when unsure", () => {
    expect(guessLanguage("Bonjour, combien pour 500 flyers ?")).toBe("fr");
    expect(guessLanguage("How much for 500 flyers?")).toBe("en");
    expect(guessLanguage("500 flyers")).toBeNull();
  });
});
