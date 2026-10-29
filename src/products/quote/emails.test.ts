import { describe, expect, it } from "vitest";
import { renderEmail } from "../../core/email/layout.js";
import { localNumber, quoteEmails, type QuoteEmailFacts } from "./emails.js";

const facts: QuoteEmailFacts = {
  live: true,
  business: "Demo Shop",
  botNumber: "0704 897 1600",
  botWaId: "2347048971600",
  priceRows: 3,
  orders: 2,
  morningSummary: false,
  planName: "Free",
  month: { chats: 41, quotes: 12, orders: 2, paidKobo: 1_250_000 },
  prices: { starter: { monthly: 700_000, yearly: 625_000 }, pro: { monthly: 2_300_000, yearly: 1_925_000 } },
};
const series = quoteEmails("https://app.yarnoga.com", async () => facts);
const render = (key: string, f = facts) => {
  const content = series.emails.find((e) => e.key === key)!.content(f, "Nsikak");
  return { content, ...renderEmail(content, { imageBase: "https://app.yarnoga.com/email/img", unsubscribeUrl: "https://u" }) };
};

describe("quote bot emails", () => {
  it("has the ten approved emails in day order", () => {
    expect(series.emails.map((e) => `${e.key}:${e.day}`)).toEqual(["Q1:0", "Q2:1", "Q3:2", "Q4:4", "Q5:7", "Q6:10", "Q7:10", "Q8:14", "Q9:21", "Q10:28"]);
  });

  it("fills in every email without gaps", () => {
    for (const e of series.emails) {
      const { text, html } = render(e.key);
      expect(text, e.key).not.toMatch(/undefined|null|NaN|\{/);
      expect(text, e.key).toContain("Hi Nsikak,");
      expect(html, e.key).toContain("Nsikak John");
    }
  });

  it("matches the approved welcome", () => {
    const { content, text } = render("Q1");
    expect(content.subject).toBe("Your yarnOga assistant is ready");
    expect(content.hero).toBe("welcome");
    expect(text).toContain("Thanks for setting up Demo Shop on yarnOga. Your assistant now answers customers on WhatsApp at 0704 897 1600");
    expect(text).toContain("Open your yarnOga app: https://app.yarnoga.com/home");
  });

  it("sends each conditional email only when it fits", () => {
    const when = (key: string, f: Partial<QuoteEmailFacts>) => series.emails.find((e) => e.key === key)!.when!({ ...facts, ...f });
    expect(when("Q2", { priceRows: 4 })).toBe(true);
    expect(when("Q2", { priceRows: 5 })).toBe(false);
    expect(when("Q6", { orders: 0 })).toBe(true);
    expect(when("Q7", { orders: 0 })).toBe(false);
  });

  it("puts the wa.me link with the first message filled in", () => {
    expect(render("Q4").text).toContain("https://wa.me/2347048971600?text=Price%20list");
  });

  it("shows plan prices from the database, and leaves out a plan that's missing", () => {
    const { text } = render("Q10");
    expect(text).toContain("Starter, ₦7,000 a month (₦6,250 a month paid yearly)");
    expect(text).toContain("Pro, ₦23,000 a month (₦19,250 a month paid yearly)");
    expect(text).toContain("Money marked paid: ₦12,500");
    const without = render("Q10", { ...facts, prices: { starter: undefined, pro: facts.prices.pro } }).text;
    expect(without).not.toContain("Starter,");
  });

  it("writes Nigerian numbers the way people do", () => {
    expect(localNumber("2347048971600")).toBe("0704 897 1600");
    expect(localNumber("447700900123")).toBe("+447700900123");
  });
});
