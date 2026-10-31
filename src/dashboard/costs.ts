import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_USD_RATE_KOBO } from "./profit.js";
import { lagosMonth, type NumberLabel } from "./stats.js";

// What each shop costs us to serve this month against what its plan pays us:
// AI replies and voice notes as counted when they happen (usage_costs,
// migration 0065), plus Meta's fee for messages past a number's free 1,000.
// Dollar costs become naira at the latest dollar rate in the profit and loss
// entries. A shop is flagged when, at this month's pace, it will cost more by
// the end of the month than its plan pays.

/** Meta charges for each message a number sends after its first 1,000 a month. */
export const META_FREE_MESSAGES = 1000;
/**
 * Meta's fee per message past the free 1,000, in millionths of a dollar.
 * $0.0067 is the October 2026 Nigeria rate reported by resellers (research,
 * 2026-10-22); WhatsApp Manager > Billing shows the exact figure.
 */
export const META_FEE_MICRO_USD = 6700;

export interface CostLine {
  aiKobo: number;
  voiceKobo: number;
  metaKobo: number;
  totalKobo: number;
}

export interface ShopCost {
  name: string;
  /** The plan's name, "No plan" when none is set. */
  plan: string;
  /** The plan's monthly list price; 0 for Free or no plan. */
  paysKobo: number;
  aiReplies: number;
  voiceNotes: number;
  voiceMinutes: number;
  sent: number;
  /** Cost so far this month. */
  cost: CostLine;
  /** Cost by the end of the month if the rest of it goes like the days so far. */
  projectedKobo: number;
  /** Will cost more than it pays this month. */
  losing: boolean;
}

export interface PlanCost {
  plan: string;
  shops: number;
  paysKobo: number;
  projectedKobo: number;
  losing: boolean;
}

export interface ShopCosts {
  /** "2026-10-01" */
  month: string;
  usdRateKobo: number;
  /** Shops, the biggest loss first. */
  shops: ShopCost[];
  plans: PlanCost[];
  /** Our numbers that aren't a shop (flyers, leads, site reports), for the full picture. */
  otherNumbers: ShopCost[];
}

export interface ShopCostInputs {
  usage: { business_number_id: string; ai_replies: number; ai_micro_usd: number; voice_notes: number; voice_seconds: number; voice_micro_usd: number }[];
  sent: { business_number_id: string; sent: number }[];
  businesses: {
    id: string;
    name: string;
    phone_number_id: string | null;
    plan_code: string | null;
    plan_paid_until: string | null;
    branch_of?: string | null;
    active: boolean;
  }[];
  plans: { code: string; name: string; monthly_price_kobo: number }[];
  /** Numbers the business connected itself, so Meta bills the business. */
  ownAccounts: string[];
  /** Our numbers, main first. */
  numbers: NumberLabel[];
  /** Business #1, answered on the main number, when the main number runs the quote bot. */
  mainBusiness?: { id: string; plan: string | null };
  usdRateKobo: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far through the Lagos month `now` is: 1 at the end, never less than one day's worth. */
function shareOfMonth(now: Date): number {
  const month = lagosMonth(now);
  const start = Date.parse(`${month}T00:00:00+01:00`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const end = Date.parse(`${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)}T00:00:00+01:00`);
  return Math.min(1, Math.max(DAY_MS, now.getTime() - start) / (end - start));
}

export function summariseShopCosts(input: ShopCostInputs, now: Date): ShopCosts {
  const mainId = input.numbers[0]?.id ?? "";
  const share = shareOfMonth(now);
  const kobo = (microUsd: number) => Math.ceil((microUsd * input.usdRateKobo) / 1_000_000);
  const metaMicroUsd = (sent: number) => Math.max(0, sent - META_FREE_MESSAGES) * META_FEE_MICRO_USD;
  const ownAccounts = new Set(input.ownAccounts);

  type Tally = { aiReplies: number; aiMicro: number; voiceNotes: number; voiceSeconds: number; voiceMicro: number; sent: number; metaMicro: number; projectedMetaMicro: number };
  const empty = (): Tally => ({ aiReplies: 0, aiMicro: 0, voiceNotes: 0, voiceSeconds: 0, voiceMicro: 0, sent: 0, metaMicro: 0, projectedMetaMicro: 0 });

  // Per number first: Meta's free 1,000 is per number.
  const perNumber = new Map<string, Tally>();
  const tally = (id: string) => perNumber.get(id || mainId) ?? perNumber.set(id || mainId, empty()).get(id || mainId)!;
  for (const u of input.usage) {
    const t = tally(u.business_number_id);
    t.aiReplies += Number(u.ai_replies);
    t.aiMicro += Number(u.ai_micro_usd);
    t.voiceNotes += Number(u.voice_notes);
    t.voiceSeconds += Number(u.voice_seconds);
    t.voiceMicro += Number(u.voice_micro_usd);
  }
  for (const s of input.sent) tally(s.business_number_id).sent += Number(s.sent);
  for (const [id, t] of perNumber) {
    if (ownAccounts.has(id)) continue;
    t.metaMicro = metaMicroUsd(t.sent);
    t.projectedMetaMicro = metaMicroUsd(Math.round(t.sent / share));
  }

  // Then per shop: a branch's numbers count under its main business.
  const byId = new Map(input.businesses.map((b) => [b.id, b]));
  const shopOf = (numberId: string) => {
    const b =
      numberId === mainId && input.mainBusiness
        ? byId.get(input.mainBusiness.id)
        : input.businesses.find((x) => x.phone_number_id === numberId);
    return b?.branch_of ? (byId.get(b.branch_of) ?? b) : b;
  };
  const shops = new Map<string, Tally>();
  const others = new Map<string, Tally>();
  for (const [numberId, t] of perNumber) {
    const shop = shopOf(numberId);
    const into = shop ? shops : others;
    const key = shop?.id ?? numberId;
    const sum = into.get(key) ?? into.set(key, empty()).get(key)!;
    for (const k of Object.keys(t) as (keyof Tally)[]) sum[k] += t[k];
  }
  for (const b of input.businesses) if (b.active && !b.branch_of && !shops.has(b.id)) shops.set(b.id, empty());

  const plans = new Map(input.plans.map((p) => [p.code, p]));
  const line = (name: string, planCode: string | null, t: Tally): ShopCost => {
    const plan = planCode ? plans.get(planCode) : undefined;
    const cost = { aiKobo: kobo(t.aiMicro), voiceKobo: kobo(t.voiceMicro), metaKobo: kobo(t.metaMicro), totalKobo: 0 };
    cost.totalKobo = cost.aiKobo + cost.voiceKobo + cost.metaKobo;
    const projectedKobo = kobo((t.aiMicro + t.voiceMicro) / share + t.projectedMetaMicro);
    const paysKobo = plan ? Number(plan.monthly_price_kobo) : 0;
    return {
      name,
      plan: plan?.name ?? planCode ?? "No plan",
      paysKobo,
      aiReplies: t.aiReplies,
      voiceNotes: t.voiceNotes,
      voiceMinutes: Math.round(t.voiceSeconds / 6) / 10,
      sent: t.sent,
      cost,
      projectedKobo,
      losing: projectedKobo > paysKobo,
    };
  };
  const planCode = (b: ShopCostInputs["businesses"][number]) => {
    const code = b.plan_code ?? (b.id === input.mainBusiness?.id ? input.mainBusiness.plan : null);
    return code && b.plan_paid_until && new Date(b.plan_paid_until) <= now ? "free" : code;
  };

  const shopLines = [...shops].map(([id, t]) => {
    const b = byId.get(id)!;
    return line(b.name, planCode(b), t);
  });
  shopLines.sort((a, b) => a.paysKobo - a.projectedKobo - (b.paysKobo - b.projectedKobo) || a.name.localeCompare(b.name));

  const planTotals = new Map<string, PlanCost>();
  for (const s of shopLines) {
    const p = planTotals.get(s.plan) ?? { plan: s.plan, shops: 0, paysKobo: 0, projectedKobo: 0, losing: false };
    p.shops++;
    p.paysKobo += s.paysKobo;
    p.projectedKobo += s.projectedKobo;
    p.losing = p.projectedKobo > p.paysKobo;
    planTotals.set(s.plan, p);
  }

  return {
    month: lagosMonth(now),
    usdRateKobo: input.usdRateKobo,
    shops: shopLines,
    plans: [...planTotals.values()].sort((a, b) => a.paysKobo / a.shops - b.paysKobo / b.shops),
    otherNumbers: [...others].map(([id, t]) => line(input.numbers.find((n) => n.id === id)?.label ?? `Number ${id}`, null, t)),
  };
}

export interface ShopCostSource {
  load(now: Date): Promise<ShopCosts>;
}

export function createSupabaseShopCosts(
  db: SupabaseClient,
  opts: { numbers: NumberLabel[]; mainBusiness?: { id: string; plan: string | null } },
): ShopCostSource {
  const read = async <T>(table: string, columns: string, filter: (q: any) => any = (q) => q): Promise<T[]> => {
    const { data, error } = await filter(db.from(table).select(columns));
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    return (data ?? []) as T[];
  };
  return {
    async load(now) {
      const month = lagosMonth(now);
      const [usage, sent, businesses, plans, connections, rate] = await Promise.all([
        read<ShopCostInputs["usage"][number]>(
          "usage_costs",
          "business_number_id, ai_replies, ai_micro_usd, voice_notes, voice_seconds, voice_micro_usd",
          (q) => q.eq("month", month),
        ),
        read<ShopCostInputs["sent"][number]>("whatsapp_sent_counts", "business_number_id, sent", (q) => q.eq("month", month)),
        // Every column, so branch_of (migration 0038) is used when it's there.
        read<ShopCostInputs["businesses"][number]>("quote_businesses", "*"),
        read<ShopCostInputs["plans"][number]>("quote_plans", "code, name, monthly_price_kobo"),
        read<{ phone_number_id: string }>("whatsapp_connections", "phone_number_id"),
        read<{ usd_rate_kobo: number }>("money_lines", "usd_rate_kobo", (q) =>
          q.eq("currency", "USD").order("entry_date", { ascending: false }).limit(1),
        ),
      ]);
      return summariseShopCosts(
        {
          usage,
          sent,
          businesses,
          plans,
          ownAccounts: connections.map((c) => c.phone_number_id),
          numbers: opts.numbers,
          mainBusiness: opts.mainBusiness,
          usdRateKobo: rate[0] ? Number(rate[0].usd_rate_kobo) : DEFAULT_USD_RATE_KOBO,
        },
        now,
      );
    },
  };
}
