import { assertKobo } from "../../core/money.js";

// Works out a quote from the price list. This is the only place a price is
// calculated: the AI can tell us WHAT the customer wants, but the numbers
// always come from here, using prices read from the database.

export interface PriceTier {
  /** The tier applies to orders of at least this many pieces. */
  minQuantity: number;
  /** Price for one piece, in kobo. */
  unitPriceKobo: number;
}

export interface Variant {
  id: string;
  /** e.g. "Flyers: A5, 150gsm gloss, double-sided" */
  name: string;
  minQuantity: number;
  tiers: PriceTier[];
  /** The owner's notes about the item (colours, delivery time, ...), from extra price list columns. */
  details?: string;
}

export interface QuoteLine {
  variantId: string;
  name: string;
  quantity: number;
  unitPriceKobo: number;
  totalKobo: number;
}

export type QuoteResult =
  | { ok: true; line: QuoteLine }
  | { ok: false; reason: "below_minimum"; minQuantity: number }
  | { ok: false; reason: "no_price" };

/** Prices `quantity` pieces of a variant using the best tier the quantity reaches. */
export function quoteLine(variant: Variant, quantity: number): QuoteResult {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`Quantity must be a whole number of at least 1 (got ${quantity})`);
  }
  if (quantity < variant.minQuantity) {
    return { ok: false, reason: "below_minimum", minQuantity: variant.minQuantity };
  }

  // Highest tier whose threshold the quantity meets.
  let tier: PriceTier | undefined;
  for (const t of variant.tiers) {
    if (quantity >= t.minQuantity && (!tier || t.minQuantity > tier.minQuantity)) tier = t;
  }
  if (!tier) return { ok: false, reason: "no_price" };

  const unitPriceKobo = assertKobo(tier.unitPriceKobo, "unit price");
  const totalKobo = assertKobo(unitPriceKobo * quantity, "line total");
  return {
    ok: true,
    line: { variantId: variant.id, name: variant.name, quantity, unitPriceKobo, totalKobo },
  };
}

/** Adds up line totals. */
export function quoteTotal(lines: QuoteLine[]): number {
  return assertKobo(
    lines.reduce((sum, l) => sum + l.totalKobo, 0),
    "quote total",
  );
}
