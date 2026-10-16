import { describe, expect, it } from "vitest";
import { createPlanFeatures, type FeatureRow, type FeatureStore } from "./features.js";

const rows: Record<string, FeatureRow> = {
  "free/voice_notes": { included: false, usageLimit: null },
  "free/ai_credits": { included: true, usageLimit: 300 },
};

function store(overrides: Partial<FeatureStore> = {}): FeatureStore {
  return {
    businessPlanCode: async () => null,
    feature: async (plan, feature) => rows[`${plan}/${feature}`] ?? null,
    ...overrides,
  };
}

const quiet = { error() {} };

describe("plan features", () => {
  it("reads what the plan includes and its caps", async () => {
    const f = createPlanFeatures({ code: "free", store: store() });
    expect(await f.has("voice_notes")).toBe(false);
    expect(await f.has("ai_credits")).toBe(true);
    expect(await f.limit("ai_credits")).toBe(300);
  });

  it("gives everything to a business with no plan", async () => {
    const f = createPlanFeatures({ store: store() });
    expect(await f.planCode()).toBeNull();
    expect(await f.has("voice_notes")).toBe(true);
    expect(await f.limit("ai_credits")).toBeNull();
  });

  it("reads the plan from the business's row when no code is given", async () => {
    const f = createPlanFeatures({ store: store({ businessPlanCode: async () => "free" }) });
    expect(await f.has("voice_notes")).toBe(false);
  });

  it("treats a feature with no row as included with no cap", async () => {
    const f = createPlanFeatures({ code: "free", store: store() });
    expect(await f.has("broadcasts")).toBe(true);
    expect(await f.limit("broadcasts")).toBeNull();
  });

  it("lets everything through when the database fails", async () => {
    const broken = store({ feature: async () => Promise.reject(new Error("down")), businessPlanCode: async () => Promise.reject(new Error("down")) });
    expect(await createPlanFeatures({ code: "free", store: broken, log: quiet }).has("voice_notes")).toBe(true);
    expect(await createPlanFeatures({ store: broken, log: quiet }).limit("ai_credits")).toBeNull();
  });
});
