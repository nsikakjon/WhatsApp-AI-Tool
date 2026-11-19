import { assertKobo } from "../../core/money.js";
import type { PriceTier } from "./pricing.js";

// A sale on a product (migration 0094): every price of every option is a
// percentage lower until the sale's last day. The percentage and the end
// date are the owner's, saved in the database; this is the one place the
// sale price is worked out, for the bot's quotes and the shop page alike.

export interface Sale {
  percent: number;
  /** The moment the sale stops: the end of its last day in Lagos. */
  endsAt: Date;
}

/** The product row's sale, when there's one still running. */
export function activeSale(row: { sale_percent?: number | null; sale_ends_at?: string | null }, now: Date): Sale | null {
  const percent = Number(row.sale_percent);
  if (!row.sale_ends_at || !Number.isInteger(percent) || percent < 1 || percent > 90) return null;
  const endsAt = new Date(row.sale_ends_at);
  return endsAt > now ? { percent, endsAt } : null;
}

/** A price with the sale taken off, rounded to a whole naira (or cedi, franc, ...). */
export function salePrice(kobo: number, percent: number): number {
  return assertKobo(Math.round((kobo * (100 - percent)) / 10_000) * 100, "sale price");
}

export function saleTiers(tiers: PriceTier[], sale: Sale | null): PriceTier[] {
  return sale ? tiers.map((t) => ({ ...t, unitPriceKobo: salePrice(t.unitPriceKobo, sale.percent) })) : tiers;
}

/** "2026-11-30" -> the end of that day in Lagos (UTC+1). Null when it isn't a real date. */
export function saleEndsAt(day: string): Date | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const check = new Date(Date.UTC(y, mo, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d) return null;
  return new Date(Date.UTC(y, mo, d + 1, -1));
}

/** The sale's last day as the date box shows it, "2026-11-30". */
export const saleLastDate = (endsAt: Date) => new Date(endsAt.getTime() - 1 + 3_600_000).toISOString().slice(0, 10);
