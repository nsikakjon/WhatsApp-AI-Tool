import type { SupabaseClient } from "@supabase/supabase-js";
import { readBusinessPlanCode } from "./plan.js";

// What each quote bot plan includes: AI credits, number of products, voice
// notes, invoices, staff inbox, follow-ups, broadcasts, test screen, delivery,
// order board, sales dashboard, product photos and stock (catalogue), and
// how many numbers a business and its branches can have (branches).
// The rows live in quote_plan_features (migrations 0025, 0034); limits are changed
// there, never in code.
//
// For other parts of the quote bot (follow-ups, broadcasts, set-up screen):
//
//   const features = createPlanFeatures({ store: createSupabaseFeatureStore(db, businessId) });
//   if (!(await features.has("follow_ups"))) return;          // not on this plan
//   const max = await features.limit("broadcasts");            // null = no cap
//
// Rules that keep live bots safe:
// - A business with no plan gets everything with no caps (how KahnPrints runs).
// - A feature with no row for the plan counts as included with no cap.
// - If the database can't be read, the feature counts as included, so a
//   hiccup never stops a sale. The problem is logged.
// - Nothing calls this unless QUOTE_PLAN_FEATURES=true (see src/index.ts).

export type PlanFeature =
  | "ai_credits"
  | "products"
  | "voice_notes"
  | "invoices"
  | "staff_inbox"
  | "follow_ups"
  | "broadcasts"
  | "test_screen"
  | "delivery"
  | "order_board"
  | "sales_dashboard"
  | "catalogue"
  | "branches";

export interface FeatureRow {
  included: boolean;
  /** How much of the feature the plan gets (e.g. AI credits a month). Null = no cap. */
  usageLimit: number | null;
}

export interface FeatureStore {
  /** The plan code saved on this business's row, or null for none. */
  businessPlanCode(): Promise<string | null>;
  /** The plan's row for this feature, or null when there isn't one. */
  feature(planCode: string, feature: PlanFeature): Promise<FeatureRow | null>;
}

export interface PlanFeatures {
  /** The plan this business is on, or null for none (everything included). */
  planCode(): Promise<string | null>;
  /** Whether the business's plan includes this feature. */
  has(feature: PlanFeature): Promise<boolean>;
  /** The plan's cap for this feature, or null for no cap (or not included: check has() first). */
  limit(feature: PlanFeature): Promise<number | null>;
}

export interface PlanFeaturesOptions {
  /** The plan code (QUOTE_PLAN for business #1). Leave out to read it from the business's row. */
  code?: string;
  store: FeatureStore;
  log?: Pick<Console, "error">;
}

const EVERYTHING: FeatureRow = { included: true, usageLimit: null };

export function createPlanFeatures(opts: PlanFeaturesOptions): PlanFeatures {
  const log = opts.log ?? console;

  // Same rule as plan.ts: a plan paid for in the chat (saved on the
  // business's row) wins over QUOTE_PLAN.
  async function planCode(): Promise<string | null> {
    try {
      const saved = await opts.store.businessPlanCode();
      if (saved) return saved;
    } catch (err) {
      log.error("Could not read the business's plan:", err);
    }
    return opts.code ?? null;
  }

  async function row(feature: PlanFeature): Promise<FeatureRow> {
    const code = await planCode();
    if (!code) return EVERYTHING;
    try {
      return (await opts.store.feature(code, feature)) ?? EVERYTHING;
    } catch (err) {
      log.error(`Could not read "${feature}" for plan "${code}":`, err);
      return EVERYTHING;
    }
  }

  return {
    planCode,
    async has(feature) {
      return (await row(feature)).included;
    },
    async limit(feature) {
      return (await row(feature)).usageLimit;
    },
  };
}

export function createSupabaseFeatureStore(db: SupabaseClient, businessId: string): FeatureStore {
  return {
    businessPlanCode: () => readBusinessPlanCode(db, businessId),
    async feature(planCode, feature) {
      const { data, error } = await db
        .from("quote_plan_features")
        .select("included, usage_limit")
        .eq("plan_code", planCode)
        .eq("feature", feature)
        .maybeSingle();
      if (error) throw new Error(`feature failed: ${error.message}`);
      return data ? { included: data.included as boolean, usageLimit: (data.usage_limit as number | null) ?? null } : null;
    },
  };
}
