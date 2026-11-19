import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHundredths, usdToKobo, type Currency } from "./profit.js";

// yarnOga's balance sheet: what it owns, what it owes, and what's left (the
// owner's share, or equity). Bank and payment balances, bills and loans are
// typed in by the owner, because the app can't see them. The money shops have
// put on their payout balances is read from payout_ledger: it sits in
// yarnOga's Paystack account but belongs to the shops.

export type BalanceKind = "cash" | "owed_to_us" | "owned" | "bill" | "loan" | "owed";

export const BALANCE_GROUPS: { kind: BalanceKind; side: "owns" | "owes"; label: string }[] = [
  { kind: "cash", side: "owns", label: "Cash and bank" },
  { kind: "owed_to_us", side: "owns", label: "Owed to us" },
  { kind: "owned", side: "owns", label: "Other things we own" },
  { kind: "bill", side: "owes", label: "Bills to pay" },
  { kind: "loan", side: "owes", label: "Loans" },
  { kind: "owed", side: "owes", label: "Other money we owe" },
];

export interface NewBalanceItem {
  kind: BalanceKind;
  item: string;
  /** In the currency it's in: kobo for NGN, cents for USD. */
  amountMinor: number;
  currency: Currency;
  /** Kobo per $1, for USD only. */
  usdRateKobo: number | null;
  amountKobo: number;
  /** "2026-11-19": the day the amount was checked. */
  asOf: string;
  notes: string | null;
}

export interface BalanceItem extends NewBalanceItem {
  id: number;
}

/** Shops' payout balances: money they added to pay riders and staff, not yet sent. */
export interface HeldForShops {
  totalKobo: number;
  /** Biggest first. */
  shops: { name: string; kobo: number }[];
}

export interface BalanceStore {
  list(): Promise<BalanceItem[]>;
  heldForShops(): Promise<HeldForShops>;
  add(item: NewBalanceItem): Promise<void>;
  update(id: number, item: NewBalanceItem): Promise<void>;
  remove(id: number): Promise<void>;
}

export interface BalanceGroup {
  kind: BalanceKind;
  side: "owns" | "owes";
  label: string;
  /** Biggest first. */
  items: BalanceItem[];
  totalKobo: number;
}

export interface BalanceSheet {
  groups: BalanceGroup[];
  heldForShops: HeldForShops | "error";
  ownsKobo: number;
  owesKobo: number;
  /** Owns minus owes; negative means yarnOga owes more than it has. */
  equityKobo: number;
  items: BalanceItem[];
}

export function summariseBalance(items: BalanceItem[], heldForShops: HeldForShops | "error"): BalanceSheet {
  const groups = BALANCE_GROUPS.map((g) => {
    const mine = items.filter((i) => i.kind === g.kind).sort((a, b) => b.amountKobo - a.amountKobo || a.id - b.id);
    return { ...g, items: mine, totalKobo: mine.reduce((sum, i) => sum + i.amountKobo, 0) };
  });
  const sideTotal = (side: "owns" | "owes") => groups.filter((g) => g.side === side).reduce((sum, g) => sum + g.totalKobo, 0);
  const ownsKobo = sideTotal("owns");
  const owesKobo = sideTotal("owes") + (heldForShops === "error" ? 0 : heldForShops.totalKobo);
  return { groups, heldForShops, ownsKobo, owesKobo, equityKobo: ownsKobo - owesKobo, items };
}

/** Turns the balance sheet's "Add a line" or "Edit" form into an item, or explains what's wrong. */
export function parseBalanceForm(form: Record<string, unknown>): NewBalanceItem | { problem: string } {
  const text = (name: string, max = 200) => {
    const value = form[name];
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const kind = BALANCE_GROUPS.find((g) => g.kind === text("kind"))?.kind;
  if (!kind) return { problem: "Choose which part of the balance sheet it goes in." };
  const item = text("item");
  if (!item) return { problem: "Say what it is, like Moniepoint account or Railway bill." };
  const currency = text("currency");
  if (currency !== "NGN" && currency !== "USD") return { problem: "Choose naira or dollars." };
  const amountMinor = parseHundredths(text("amount"));
  if (amountMinor === null) return { problem: "Type the amount as a number, like 45000 or 25." };
  let usdRateKobo: number | null = null;
  if (currency === "USD") {
    usdRateKobo = parseHundredths(text("rate"));
    if (!usdRateKobo) return { problem: "For a dollar amount, type how many naira $1 costs, like 1370." };
  }
  const asOf = text("as_of");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
    return { problem: "Pick the date you checked the amount." };
  }
  return {
    kind,
    item,
    amountMinor,
    currency,
    usdRateKobo,
    amountKobo: usdRateKobo === null ? amountMinor : usdToKobo(amountMinor, usdRateKobo),
    asOf,
    notes: text("notes", 500) || null,
  };
}

interface BalanceRow {
  id: number;
  kind: BalanceKind;
  item: string;
  amount_minor: number;
  currency: Currency;
  usd_rate_kobo: number | null;
  amount_kobo: number;
  as_of: string;
  notes: string | null;
}

function toRow(i: NewBalanceItem) {
  return {
    kind: i.kind,
    item: i.item,
    amount_minor: i.amountMinor,
    currency: i.currency,
    usd_rate_kobo: i.usdRateKobo,
    amount_kobo: i.amountKobo,
    as_of: i.asOf,
    notes: i.notes,
  };
}

export function createSupabaseBalanceStore(db: SupabaseClient): BalanceStore {
  return {
    async list() {
      const { data, error } = await db
        .from("balance_items")
        .select("id, kind, item, amount_minor, currency, usd_rate_kobo, amount_kobo, as_of, notes");
      if (error) throw new Error(`Reading the balance sheet failed: ${error.message}`);
      return ((data ?? []) as BalanceRow[]).map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        item: r.item,
        amountMinor: Number(r.amount_minor),
        currency: r.currency,
        usdRateKobo: r.usd_rate_kobo === null ? null : Number(r.usd_rate_kobo),
        amountKobo: Number(r.amount_kobo),
        asOf: r.as_of,
        notes: r.notes,
      }));
    },
    async heldForShops() {
      const byShop = new Map<string, { name: string; kobo: number }>();
      const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await db
          .from("payout_ledger")
          .select("id, business_id, amount_kobo, quote_businesses(name)")
          .order("id")
          .range(from, from + page - 1);
        if (error) throw new Error(`Reading payout balances failed: ${error.message}`);
        const rows = (data ?? []) as unknown as { business_id: string; amount_kobo: number; quote_businesses: { name: string } | null }[];
        for (const r of rows) {
          const shop = byShop.get(r.business_id) ?? { name: r.quote_businesses?.name ?? "A shop", kobo: 0 };
          shop.kobo += Number(r.amount_kobo);
          byShop.set(r.business_id, shop);
        }
        if (rows.length < page) break;
      }
      const shops = [...byShop.values()].filter((s) => s.kobo > 0).sort((a, b) => b.kobo - a.kobo);
      return { totalKobo: shops.reduce((sum, s) => sum + s.kobo, 0), shops };
    },
    async add(i) {
      const { error } = await db.from("balance_items").insert(toRow(i));
      if (error) throw new Error(`Saving a balance sheet line failed: ${error.message}`);
    },
    async update(id, i) {
      const { error } = await db.from("balance_items").update(toRow(i)).eq("id", id);
      if (error) throw new Error(`Changing a balance sheet line failed: ${error.message}`);
    },
    async remove(id) {
      const { error } = await db.from("balance_items").delete().eq("id", id);
      if (error) throw new Error(`Removing a balance sheet line failed: ${error.message}`);
    },
  };
}
