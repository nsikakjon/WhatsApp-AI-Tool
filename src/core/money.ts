// Money helpers. All amounts are whole kobo (₦1 = 100 kobo) stored as integers,
// so sums never pick up rounding errors. Naira only appears when we format text
// for a customer to read.

/** Throws unless the value is a whole, non-negative number of kobo. */
export function assertKobo(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole, non-negative number of kobo (got ${value})`);
  }
  return value;
}

/** Formats kobo for display, e.g. 1250000 -> "₦12,500" and 1250050 -> "₦12,500.50". */
export function formatNaira(kobo: number): string {
  assertKobo(kobo);
  const naira = Math.floor(kobo / 100);
  const remainder = kobo % 100;
  const whole = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return remainder === 0 ? `₦${whole}` : `₦${whole}.${remainder.toString().padStart(2, "0")}`;
}
