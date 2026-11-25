import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { QuotePlan } from "./plan.js";
import { asksAboutPlans, asksForWalkthrough, buildSupportPrompt, createClaudeSupport, leavesDemo, planFacts, planList } from "./support.js";

const plan = (code: string, name: string, monthly: number, yearly: number | null, description: string): QuotePlan => ({
  code,
  name,
  monthlyPriceKobo: monthly,
  monthlyPricePaidYearlyKobo: yearly,
  setupFeeKobo: 0,
  monthlyOrderLimit: null,
  showCredit: false,
  description,
});
const FREE = plan("free", "Free", 0, null, "50 orders a month");
const PAID = [plan("starter", "Starter", 1_500_000, 1_275_000, "unlimited orders"), plan("pro", "Pro", 4_300_000, 3_650_000, "delivery and riders")];

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }) } } as unknown as Anthropic;
}
const quiet = { warn: () => {}, error: () => {} };
const req = { question: "Can it take voice notes?", history: [], plans: planFacts(FREE, PAID) };

describe("yarnOga support", () => {
  it("lists the plans with prices from the database", () => {
    const list = planList(FREE, PAID, [{ name: "We set it up for you", priceKobo: 2_500_000 }]);
    expect(list).toContain("• Free: free. 50 orders a month");
    expect(list).toContain("• Starter: ₦15,000/month (₦12,750/month paid yearly). Unlimited orders");
    expect(list).toContain("• Pro: ₦43,000/month (₦36,500/month paid yearly). Delivery and riders");
    expect(list).toContain("• We set it up for you: ₦25,000");
  });

  it("gives the AI what each plan adds but no prices", () => {
    const prompt = buildSupportPrompt(req);
    expect(prompt).toContain("- Pro: delivery and riders");
    expect(prompt).not.toMatch(/15,000|43,000|₦/);
    expect(prompt).toContain("Books appointments for gyms, clinics, salons and coaches");
    expect(prompt).not.toMatch(/\b(hire|rental|rent)\b/i);
  });

  it("returns the answer, the markers, and drops an answer with a made-up number", async () => {
    const answer = (text: string) => createClaudeSupport({ apiKey: "x", model: "haiku", client: fakeClient(text), log: quiet }).answer(req);
    expect(await answer("Yes, it understands voice notes.")).toEqual({ kind: "answer", text: "Yes, it understands voice notes." });
    expect(await answer("Sign up in about 5 minutes.")).toEqual({ kind: "answer", text: "Sign up in about 5 minutes." });
    expect(await answer("PLANS")).toEqual({ kind: "plans" });
    expect(await answer("DEMO")).toEqual({ kind: "demo" });
    expect(await answer("UNCLEAR.")).toEqual({ kind: "unclear" });
    expect(await answer("Pro is ₦40,000 a month.")).toBeNull();
    expect(await answer("You get 200 orders.")).toBeNull();
  });

  it("knows a plans question, a walkthrough request and leaving the demo", () => {
    for (const t of ["plans", "What are your plans?", "how much is yarnOga", "How much does the Pro plan cost?", "pricing"]) expect(asksAboutPlans(t)).toBe(true);
    for (const t of ["How much for 20 T-shirts?", "price of cupcakes"]) expect(asksAboutPlans(t)).toBe(false);
    expect(asksForWalkthrough("Hi yarnOga, I'd like to book a 20-minute walkthrough for my business.")).toBe(true);
    expect(asksForWalkthrough("Can we schedule a demo call?")).toBe(true);
    expect(asksForWalkthrough("I want to try the demo")).toBe(false);
    for (const t of ["exit demo", "Exit", "back to yarnOga", "leave the demo shop"]) expect(leavesDemo(t)).toBe(true);
    expect(leavesDemo("cancel my order")).toBe(false);
  });
});
