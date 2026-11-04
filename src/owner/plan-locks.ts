import type { AppBusiness } from "./types.js";

// Turns off the owner app parts that the business's plan doesn't include
// (quote_plan_features, migration 0073). Barcodes, the offline till, the tax
// summary and staff logins come with Starter; paying riders and staff,
// monthly customer payments and the Ads page with Pro. A business with no
// plan, or a plan with no row for a feature, keeps it (features.ts).
export async function lockToPlan(biz: AppBusiness): Promise<AppBusiness> {
  const features = biz.features;
  if (!features) return biz;
  const [barcodes, till, tax, staff, payouts, monthly, ads] = await Promise.all(
    (["barcodes", "offline_till", "tax_summary", "staff_roles", "payouts", "monthly_payments", "ad_leads"] as const).map((f) => features.has(f)),
  );
  return {
    ...biz,
    barcodes: biz.barcodes && barcodes,
    counter: biz.counter && !till ? { ...biz.counter, sellOffline: undefined } : biz.counter,
    tax: tax ? biz.tax : undefined,
    staffLogins: staff,
    payouts: payouts ? biz.payouts : undefined,
    monthly: monthly ? biz.monthly : undefined,
    ads: ads ? biz.ads : undefined,
  };
}
