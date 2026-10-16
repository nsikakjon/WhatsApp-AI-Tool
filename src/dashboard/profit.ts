import type { SupabaseClient } from "@supabase/supabase-js";

// yarnOga's profit and loss: every amount of money in or out, typed in by the
// owner (or copied once from the spreadsheet ledger). Nothing here is worked
// out from guesses. Money is whole kobo; a dollar cost keeps what was actually
// paid in cents plus the naira rate used, and its naira value is what the
// totals add up.

export type MoneyKind = "income" | "expense";
export type Currency = "NGN" | "USD";

/** Used when there's no earlier dollar entry to copy the rate from (the ledger's rate, 2026-10-11). */
export const DEFAULT_USD_RATE_KOBO = 137000;

export interface NewMoneyLine {
  /** "2026-10-16" */
  date: string;
  kind: MoneyKind;
  item: string;
  supplier: string | null;
  category: string | null;
  /** In the currency paid: kobo for NGN, cents for USD. */
  amountMinor: number;
  currency: Currency;
  /** Kobo per $1, for USD only. */
  usdRateKobo: number | null;
  amountKobo: number;
  notes: string | null;
}

export interface MoneyLine extends NewMoneyLine {
  id: number;
}

export interface MoneyStore {
  list(): Promise<MoneyLine[]>;
  add(line: NewMoneyLine): Promise<void>;
  remove(id: number): Promise<void>;
}

export interface MonthTotals {
  /** "2026-10" */
  month: string;
  incomeKobo: number;
  expensesKobo: number;
  /** Income minus expenses; negative is a loss. */
  netKobo: number;
}

export interface ProfitAndLoss {
  incomeKobo: number;
  expensesKobo: number;
  netKobo: number;
  /** Newest month first. */
  months: MonthTotals[];
  /** Biggest first. */
  expensesByCategory: { category: string; kobo: number }[];
  incomeByCategory: { category: string; kobo: number }[];
  /** Newest first. */
  lines: MoneyLine[];
  /** Kobo per $1 to suggest for the next dollar entry. */
  lastUsdRateKobo: number;
}

export function summariseMoney(lines: MoneyLine[]): ProfitAndLoss {
  const sorted = [...lines].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const months = new Map<string, MonthTotals>();
  const byCategory = { income: new Map<string, number>(), expense: new Map<string, number>() };
  let incomeKobo = 0;
  let expensesKobo = 0;
  for (const line of sorted) {
    const key = line.date.slice(0, 7);
    const m = months.get(key) ?? { month: key, incomeKobo: 0, expensesKobo: 0, netKobo: 0 };
    if (line.kind === "income") {
      m.incomeKobo += line.amountKobo;
      incomeKobo += line.amountKobo;
    } else {
      m.expensesKobo += line.amountKobo;
      expensesKobo += line.amountKobo;
    }
    m.netKobo = m.incomeKobo - m.expensesKobo;
    months.set(key, m);
    const category = line.category?.trim() || "Other";
    const totals = byCategory[line.kind];
    totals.set(category, (totals.get(category) ?? 0) + line.amountKobo);
  }
  const ranked = (totals: Map<string, number>) =>
    [...totals].map(([category, kobo]) => ({ category, kobo })).sort((a, b) => b.kobo - a.kobo);
  return {
    incomeKobo,
    expensesKobo,
    netKobo: incomeKobo - expensesKobo,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    expensesByCategory: ranked(byCategory.expense),
    incomeByCategory: ranked(byCategory.income),
    lines: sorted,
    lastUsdRateKobo: sorted.find((l) => l.currency === "USD")?.usdRateKobo ?? DEFAULT_USD_RATE_KOBO,
  };
}

/** "₦12,500.50", "12500.5", "$20.18" -> 1250050 / 2018 (hundredths). Anything else -> null. */
export function parseHundredths(text: string): number | null {
  const cleaned = text.replace(/[₦$,\s]/g, "");
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Cents at a rate of kobo per $1, rounded to the nearest kobo. */
export function usdToKobo(cents: number, usdRateKobo: number): number {
  return Number((BigInt(cents) * BigInt(usdRateKobo) + 50n) / 100n);
}

/** Turns the dashboard's "Add an entry" form into a line, or explains what's wrong. */
export function parseMoneyForm(form: Record<string, unknown>): NewMoneyLine | { problem: string } {
  const text = (name: string, max = 200) => {
    const value = form[name];
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  const date = text("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { problem: "Pick the date the money went out or came in." };
  }
  const kind = text("kind");
  if (kind !== "income" && kind !== "expense") return { problem: "Choose money in or money out." };
  const item = text("item");
  if (!item) return { problem: "Say what the money was for." };
  const currency = text("currency");
  if (currency !== "NGN" && currency !== "USD") return { problem: "Choose naira or dollars." };
  const amountMinor = parseHundredths(text("amount"));
  if (amountMinor === null || amountMinor === 0) return { problem: "Type the amount as a number, like 4500 or 20.18." };
  let usdRateKobo: number | null = null;
  if (currency === "USD") {
    usdRateKobo = parseHundredths(text("rate"));
    if (!usdRateKobo) return { problem: "For a dollar amount, type how many naira $1 cost, like 1370." };
  }
  return {
    date,
    kind,
    item,
    supplier: text("supplier") || null,
    category: text("category", 60) || null,
    amountMinor,
    currency,
    usdRateKobo,
    amountKobo: usdRateKobo === null ? amountMinor : usdToKobo(amountMinor, usdRateKobo),
    notes: text("notes", 500) || null,
  };
}

interface MoneyRow {
  id: number;
  entry_date: string;
  kind: MoneyKind;
  item: string;
  supplier: string | null;
  category: string | null;
  amount_minor: number;
  currency: Currency;
  usd_rate_kobo: number | null;
  amount_kobo: number;
  notes: string | null;
}

export function createSupabaseMoneyStore(db: SupabaseClient): MoneyStore {
  return {
    async list() {
      const { data, error } = await db
        .from("money_lines")
        .select("id, entry_date, kind, item, supplier, category, amount_minor, currency, usd_rate_kobo, amount_kobo, notes");
      if (error) throw new Error(`Reading money lines failed: ${error.message}`);
      return ((data ?? []) as MoneyRow[]).map((r) => ({
        id: Number(r.id),
        date: r.entry_date,
        kind: r.kind,
        item: r.item,
        supplier: r.supplier,
        category: r.category,
        amountMinor: Number(r.amount_minor),
        currency: r.currency,
        usdRateKobo: r.usd_rate_kobo === null ? null : Number(r.usd_rate_kobo),
        amountKobo: Number(r.amount_kobo),
        notes: r.notes,
      }));
    },
    async add(l) {
      const { error } = await db.from("money_lines").insert({
        entry_date: l.date,
        kind: l.kind,
        item: l.item,
        supplier: l.supplier,
        category: l.category,
        amount_minor: l.amountMinor,
        currency: l.currency,
        usd_rate_kobo: l.usdRateKobo,
        amount_kobo: l.amountKobo,
        notes: l.notes,
      });
      if (error) throw new Error(`Saving a money line failed: ${error.message}`);
    },
    async remove(id) {
      const { error } = await db.from("money_lines").delete().eq("id", id);
      if (error) throw new Error(`Removing a money line failed: ${error.message}`);
    },
  };
}
