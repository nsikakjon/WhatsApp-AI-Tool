import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import type { PaymentLinks } from "../../core/payments/payments.js";
import type { Payment } from "../../core/payments/store.js";
import { lagosMonthStart } from "./plan.js";
import type { PlanFeatures } from "./features.js";

// How many business flyers a shop can make in the owner app (migration 0082).
// A plan with a monthly number (Free) makes that many, with the yarnOga tag
// and the free designs; a flyer pack bought by Paystack link adds flyers with
// every design and no tag, which don't run out at the end of the month.
//
// Packs and prices are rows in quote_flyer_packs (kobo), never code. Each
// paid pack is saved under its Paystack reference, so a retried webhook never
// adds it twice. Packs are in naira.

export interface FlyerPack {
  code: string;
  name: string;
  flyers: number;
  priceKobo: number;
}

export interface FlyerStore {
  /** Packs on sale, smallest first. */
  packs(): Promise<FlyerPack[]>;
  /** Flyers in every pack the business has paid for. */
  bought(): Promise<number>;
  /** Flyers made from packs, ever. */
  madeFromPacks(): Promise<number>;
  /** Flyers made on the plan since then. */
  madeOnPlan(since: Date): Promise<number>;
  record(paidBy: "plan" | "pack"): Promise<void>;
}

export interface FlyerLedger {
  /** Saves a paid pack; false when this reference was already saved. */
  add(t: { reference: string; businessId: string; packCode: string; flyers: number; amountKobo: number }): Promise<boolean>;
}

export interface FlyerStatus {
  /** The plan's flyers a month, or null for no limit. */
  planLimit: number | null;
  /** Left on the plan this month (null: no limit). */
  planLeft: number | null;
  /** Left from packs. */
  packLeft: number;
}

export interface FlyerAllowance {
  status(): Promise<FlyerStatus>;
  /** Counts one flyer: from a pack when there is one, else the plan. Null when nothing is left. */
  use(): Promise<"plan" | "pack" | null>;
  /** Packs the business can buy (none when it isn't in naira or payments are off). */
  packs(): Promise<FlyerPack[]>;
  /** A payment link for a pack, or null when it isn't on sale. */
  link(packCode: string, waId: string): Promise<string | null>;
}

export interface FlyerAllowanceOptions {
  businessId: string;
  features: PlanFeatures;
  store: FlyerStore;
  /** Leave out when packs can't be sold to this business. */
  links?: PaymentLinks;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const NO_LIMIT: FlyerStatus = { planLimit: null, planLeft: null, packLeft: 0 };

export function createFlyerAllowance(opts: FlyerAllowanceOptions): FlyerAllowance {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;

  async function status(): Promise<FlyerStatus> {
    try {
      const planLimit = (await opts.features.has("business_flyers")) ? await opts.features.limit("business_flyers") : 0;
      // A plan with no limit never needs a pack, so the pack tables aren't read (they may not exist yet).
      if (planLimit == null) return NO_LIMIT;
      const [bought, fromPacks, onPlan] = await Promise.all([opts.store.bought(), opts.store.madeFromPacks(), opts.store.madeOnPlan(lagosMonthStart(now()))]);
      return { planLimit, planLeft: Math.max(0, planLimit - onPlan), packLeft: Math.max(0, bought - fromPacks) };
    } catch (err) {
      // A hiccup never stops a flyer, like the other plan checks (features.ts).
      log.error("Could not read the flyer allowance:", err);
      return NO_LIMIT;
    }
  }

  const packs = async () => (opts.links ? opts.store.packs() : []);

  return {
    status,
    packs,

    async use() {
      const s = await status();
      if (s.planLimit == null) return "plan";
      const paidBy = s.packLeft > 0 ? "pack" : s.planLeft! > 0 ? "plan" : null;
      if (paidBy) await opts.store.record(paidBy);
      return paidBy;
    },

    async link(packCode, waId) {
      const pack = (await packs()).find((p) => p.code === packCode);
      if (!pack || !opts.links) return null;
      const made = await opts.links.createLink({
        product: "quote",
        waId,
        amountKobo: pack.priceKobo,
        purpose: { kind: "flyer_pack", businessId: opts.businessId, pack: pack.code, flyers: pack.flyers },
        title: `yarnOga ${pack.name}`,
      });
      return made.url ?? null;
    },
  };
}

/** What happens once a pack is paid: its flyers are added. Returns the owner's thank-you, or null when this payment was already counted. */
export function createFlyerPackPaidHandler(ledger: FlyerLedger): (payment: Payment) => Promise<string | null> {
  return async (payment) => {
    const { businessId, pack, flyers } = payment.purpose as { businessId?: unknown; pack?: unknown; flyers?: unknown };
    if (typeof businessId !== "string" || typeof pack !== "string" || !Number.isInteger(flyers) || (flyers as number) < 1) {
      throw new Error(`Payment ${payment.reference} is a flyer pack we can't read: ${JSON.stringify(payment.purpose)}`);
    }
    const added = await ledger.add({ reference: payment.reference, businessId, packCode: pack, flyers: flyers as number, amountKobo: payment.amountKobo });
    if (!added) return null;
    return `✅ Payment of ${formatNaira(payment.amountKobo)} received, thank you. ${flyers} flyers are added: every design, no yarnOga tag. Open Flyers in your app to make one.`;
  };
}

export function createSupabaseFlyerCountStore(db: SupabaseClient, businessId: string): FlyerStore {
  const count = async (paidBy: "plan" | "pack", since?: Date) => {
    let q = db.from("quote_flyers_made").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("paid_by", paidBy);
    if (since) q = q.gte("made_at", since.toISOString());
    const { count: n, error } = await q;
    if (error) throw new Error(`Flyers made failed: ${error.message}`);
    return n ?? 0;
  };
  return {
    async packs() {
      const { data, error } = await db.from("quote_flyer_packs").select("code, name, flyers, price_kobo").eq("active", true).order("sort_order").order("flyers");
      if (error) throw new Error(`Flyer packs failed: ${error.message}`);
      return (data ?? []).map((r) => ({ code: r.code as string, name: r.name as string, flyers: Number(r.flyers), priceKobo: Number(r.price_kobo) }));
    },
    async bought() {
      const { data, error } = await db.from("quote_flyer_topups").select("flyers").eq("business_id", businessId);
      if (error) throw new Error(`Flyer packs bought failed: ${error.message}`);
      return (data ?? []).reduce((sum, r) => sum + Number(r.flyers), 0);
    },
    madeFromPacks: () => count("pack"),
    madeOnPlan: (since) => count("plan", since),
    async record(paidBy) {
      const { error } = await db.from("quote_flyers_made").insert({ business_id: businessId, paid_by: paidBy });
      if (error) throw new Error(`Saving a flyer made failed: ${error.message}`);
    },
  };
}

export function createSupabaseFlyerPackLedger(db: SupabaseClient): FlyerLedger {
  return {
    async add(t) {
      const { data, error } = await db
        .from("quote_flyer_topups")
        .upsert({ reference: t.reference, business_id: t.businessId, pack_code: t.packCode, flyers: t.flyers, amount_kobo: t.amountKobo }, { onConflict: "reference", ignoreDuplicates: true })
        .select("reference");
      if (error) throw new Error(`Saving a flyer pack failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
