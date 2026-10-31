import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { parseFlyerPlanForm, parseQuotePlanForm, renderPlanEditor, type FlyerPlanEdit, type PlanEditorStore, type PlanFeature, type Plans, type QuotePlanEdit } from "./plans.js";
import { sampleStats } from "./testing.js";

function samplePlans(): Plans {
  return {
    quote: [
      {
        code: "free",
        name: "Free",
        monthlyPriceKobo: 0,
        yearlyPriceKobo: null,
        setupFeeKobo: 0,
        orderLimit: 50,
        showCredit: true,
        active: true,
        description: "50 orders a month",
        features: [
          { feature: "ai_credits", included: true, usageLimit: 500 },
          { feature: "voice_notes", included: false, usageLimit: null },
        ],
      },
      {
        code: "starter",
        name: "Starter",
        monthlyPriceKobo: 700000,
        yearlyPriceKobo: 625000,
        setupFeeKobo: 0,
        orderLimit: null,
        showCredit: false,
        active: true,
        description: null,
        features: [{ feature: "ai_credits", included: true, usageLimit: 2500 }],
      },
    ],
    flyer: [{ id: "standard", monthlyPriceKobo: 450000, yearlyPriceKobo: 250000, startingPriceKobo: null }],
  };
}

describe("reading the plan forms", () => {
  it("turns naira into kobo and blanks into no limit or no yearly option", () => {
    const edit = parseQuotePlanForm(
      { monthly: "7,500", yearly: "", setup: "", orders: "", description: " more replies ", active: "on", on_ai_credits: "on", limit_ai_credits: "3,000", limit_voice_notes: "" },
      ["ai_credits", "voice_notes"],
    );
    expect(edit).toEqual({
      plan: { monthlyPriceKobo: 750000, yearlyPriceKobo: null, setupFeeKobo: 0, orderLimit: null, showCredit: false, active: true, description: "more replies" },
      features: [
        { feature: "ai_credits", included: true, usageLimit: 3000 },
        { feature: "voice_notes", included: false, usageLimit: null },
      ],
    });
  });

  it("refuses a missing price or a limit that isn't a whole number", () => {
    expect(parseQuotePlanForm({ monthly: "" }, [])).toEqual({ problem: expect.stringContaining("monthly price") });
    expect(parseQuotePlanForm({ monthly: "abc" }, [])).toEqual({ problem: expect.stringContaining("monthly price") });
    expect(parseQuotePlanForm({ monthly: "0", orders: "ten" }, [])).toEqual({ problem: expect.stringContaining("orders") });
    expect(parseQuotePlanForm({ monthly: "0", limit_ai_credits: "1.5" }, ["ai_credits"])).toEqual({ problem: expect.stringContaining("AI replies") });
  });

  it("reads a flyer plan's prices", () => {
    expect(parseFlyerPlanForm({ monthly: "4500", yearly: "2500.50", starting: "" })).toEqual({
      monthlyPriceKobo: 450000,
      yearlyPriceKobo: 250050,
      startingPriceKobo: null,
    });
    expect(parseFlyerPlanForm({ monthly: "₦4,500", yearly: "lots" })).toEqual({ problem: expect.any(String) });
  });
});

describe("the plan editor page", () => {
  it("shows each plan's prices in naira and its features with their limits", () => {
    const html = renderPlanEditor(samplePlans());
    expect(html).toContain('action="/dashboard/plans/quote/starter"');
    expect(html).toContain('name="monthly" value="7000"');
    expect(html).toContain('name="yearly" value="6250"');
    expect(html).toContain("saved as 700,000 kobo");
    expect(html).toContain('name="limit_ai_credits" value="500"');
    expect(html).toMatch(/name="on_voice_notes" aria-label="Voice notes included">/);
    expect(html).toContain('action="/dashboard/plans/flyer/standard"');
  });

  it("confirms a save and shows a problem", () => {
    expect(renderPlanEditor(samplePlans(), { saved: "Starter" })).toContain("Saved Starter.");
    expect(renderPlanEditor(samplePlans(), { problem: "Type the monthly price" })).toContain('role="alert">Type the monthly price');
    expect(renderPlanEditor("error")).toContain("Couldn't read the plans");
  });
});

describe("plan editor routes", () => {
  const host = "x.up.railway.app";
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: host };
  const post = (body: Record<string, string>, origin = `https://${host}`) =>
    ({ method: "POST", headers: { ...auth, Origin: origin }, body: new URLSearchParams(body) }) as const;

  function setup() {
    const saved: { quote: [string, QuotePlanEdit, PlanFeature[]][]; flyer: [string, FlyerPlanEdit][] } = { quote: [], flyer: [] };
    const plans: PlanEditorStore = {
      load: async () => samplePlans(),
      saveQuotePlan: async (code, plan, features) => void saved.quote.push([code, plan, features]),
      saveFlyerPlan: async (id, plan) => void saved.flyer.push([id, plan]),
    };
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, plans });
    return { app, saved };
  }

  it("saves a quote plan with all its features and comes back to it", async () => {
    const { app, saved } = setup();
    const res = await app.request("/plans/quote/starter", post({ monthly: "8000", yearly: "7000", active: "on", on_ai_credits: "on", limit_ai_credits: "3000" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dashboard/plans?saved=Starter#quote-starter");
    expect(saved.quote[0]?.[0]).toBe("starter");
    expect(saved.quote[0]?.[1]).toMatchObject({ monthlyPriceKobo: 800000, yearlyPriceKobo: 700000 });
    expect(saved.quote[0]?.[2]).toEqual([{ feature: "ai_credits", included: true, usageLimit: 3000 }]);
  });

  it("explains a mistake without saving, and won't save a plan that doesn't exist", async () => {
    const { app, saved } = setup();
    const bad = await app.request("/plans/quote/starter", post({ monthly: "" }));
    expect(bad.headers.get("location")).toContain("problem=");
    const missing = await app.request("/plans/quote/gold", post({ monthly: "1" }));
    expect(missing.headers.get("location")).toContain("doesn't%20exist");
    expect(saved.quote).toEqual([]);
  });

  it("saves a flyer plan's prices", async () => {
    const { app, saved } = setup();
    await app.request("/plans/flyer/standard", post({ monthly: "5000", yearly: "3000" }));
    expect(saved.flyer).toEqual([["standard", { monthlyPriceKobo: 500000, yearlyPriceKobo: 300000, startingPriceKobo: null }]]);
  });

  it("only takes forms sent from the dashboard, and needs the password", async () => {
    const { app, saved } = setup();
    expect((await app.request("/plans/flyer/standard", post({ monthly: "1" }, "https://evil.example"))).status).toBe(403);
    expect((await app.request("/plans", { headers: { Host: host } })).status).toBe(401);
    expect(saved.flyer).toEqual([]);
  });

  it("links the editor from the dashboard only when it's switched on", async () => {
    const { app } = setup();
    expect(await (await app.request("/", { headers: auth })).text()).toContain('href="/dashboard/plans"');
    expect((await app.request("/plans", { headers: auth })).status).toBe(200);
    const off = createDashboard({ password: "secret", stats: { load: async () => sampleStats() } });
    expect((await off.request("/plans", { headers: auth })).status).toBe(404);
  });
});
