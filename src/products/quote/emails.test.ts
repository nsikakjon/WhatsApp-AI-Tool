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
  pharmacy: false,
  morningSummary: false,
  orderAgain: false,
  shopUrl: "https://app.yarnoga.com/shop/demo-shop",
  planName: "Free",
  month: { chats: 41, quotes: 12, orders: 2, paidKobo: 1_250_000 },
  prices: { starter: { monthly: 700_000, yearly: 625_000 }, pro: { monthly: 2_300_000, yearly: 1_925_000 } },
};
const all = { shop: true, counterSales: true, discountCodes: true, broadcasts: true };
const series = quoteEmails("https://app.yarnoga.com", async () => facts, all);
const render = (key: string, f = facts) => {
  const content = series.emails.find((e) => e.key === key)!.content(f, "Nsikak");
  return { content, ...renderEmail(content, { imageBase: "https://app.yarnoga.com/email/img", unsubscribeUrl: "https://u" }) };
};

describe("quote bot emails", () => {
  it("has the ten approved emails and the feature guides in day order", () => {
    expect(series.emails.map((e) => `${e.key}:${e.day}`)).toEqual([
      "Q1:0", "Q2:1", "Q3:2", "Q4:4", "G1:5", "Q5:7", "G2:8", "Q6:10", "Q7:10", "G3:12", "Q8:14", "G4:16", "G5:18", "Q9:21", "G6:24", "G7:26", "Q10:28",
    ]);
  });

  it("only has a feature's guide while the feature is on, and sends guides to paid businesses too", () => {
    const off = quoteEmails("https://app.yarnoga.com", async () => facts);
    expect(off.emails.map((e) => e.key).filter((k) => k.startsWith("G"))).toEqual(["G2", "G4", "G6"]);
    expect(series.emails.filter((e) => e.afterStop).map((e) => e.key)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
  });

  it("gives the shop link when there is one, and the shop command when not", () => {
    expect(render("G1").text).toContain("Your link is https://app.yarnoga.com/shop/demo-shop.");
    expect(render("G1", { ...facts, shopUrl: null }).text).toContain("Send shop to your bot and it replies with your link.");
    expect(render("G2").text).toContain("post your shop link as text");
    expect(quoteEmails("https://x", async () => facts).emails.find((e) => e.key === "G2")!.content(facts, "Ada").blocks.join(" ")).not.toContain("shop link");
  });

  it("says whether their plan has Order again, and gives the JOIN link", () => {
    expect(render("G6").text).toContain("Send upgrade starter to your bot");
    expect(render("G6", { ...facts, orderAgain: true }).text).toContain("Your plan has Order again and ratings.");
    expect(render("G7").text).toContain("https://wa.me/2347048971600?text=JOIN");
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
    expect(text).not.toContain("prescription");
  });

  it("warns pharmacies about prescription medicines in the welcome", () => {
    expect(render("Q1", { ...facts, pharmacy: true }).text).toContain("ban selling prescription medicines on WhatsApp");
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
