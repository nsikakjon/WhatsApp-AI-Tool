import type { Lang } from "./i18n.js";

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

/**
 * The currencies a business can price in. Amounts are always whole numbers of
 * the currency's hundredths (kobo for naira, centimes for CFA francs), so the
 * same integer columns and sums work for every currency.
 *   NGN  Nigerian naira
 *   XOF  West African CFA franc (Senegal, Côte d'Ivoire, Benin, Togo, Mali, Burkina Faso, Niger, Guinea-Bissau)
 *   XAF  Central African CFA franc (Cameroon, Gabon, Congo, Chad, Central African Republic, Equatorial Guinea)
 * CFA francs have no coins below 1 franc, so CFA prices are whole francs.
 */
export type Currency = "NGN" | "XOF" | "XAF";
export const CURRENCIES: Currency[] = ["NGN", "XOF", "XAF"];

export function isCurrency(value: unknown): value is Currency {
  return value === "NGN" || value === "XOF" || value === "XAF";
}

/** The currency's sign or name as people write it next to a price: "₦" or "FCFA". */
export function currencySign(currency: Currency): string {
  return currency === "NGN" ? "₦" : "FCFA";
}

/** The currency's name in a sentence, e.g. "fee in naira" or "frais en francs CFA". */
export function currencyName(currency: Currency, lang: Lang = "en"): string {
  if (currency === "NGN") return "naira";
  return lang === "fr" ? "francs CFA" : "CFA francs";
}

/**
 * Formats an amount for display: 1250000 -> "₦12,500" in naira, and
 * 500000 -> "5 000 FCFA" in CFA francs (the French way, with a space every
 * three digits and FCFA after the number).
 */
export function formatMoney(minor: number, currency: Currency = "NGN"): string {
  if (currency === "NGN") return formatNaira(minor);
  assertKobo(minor);
  const francs = Math.floor(minor / 100);
  const rest = minor % 100;
  // A non-breaking space keeps "5 000 FCFA" on one line.
  const whole = francs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${whole}${rest ? `,${rest.toString().padStart(2, "0")}` : ""} FCFA`;
}

/**
 * The currencies yarnOga's own plans can be paid in. Businesses price in a
 * Currency; a plan can also be paid in Ghana cedis, Kenyan shillings or US
 * dollars, at fixed prices from the plan_prices table (migration 0062).
 * Amounts are hundredths here too (pesewas, cents).
 */
export type PayCurrency = Currency | "GHS" | "KES" | "USD";

export function isPayCurrency(value: unknown): value is PayCurrency {
  return isCurrency(value) || value === "GHS" || value === "KES" || value === "USD";
}

/** Formats a plan payment: "₦7,000", "3 500 FCFA", "GH₵70", "KSh 850" or "$5.50". */
export function formatPayMoney(minor: number, currency: PayCurrency): string {
  if (isCurrency(currency)) return formatMoney(minor, currency);
  assertKobo(minor);
  const whole = Math.floor(minor / 100).toLocaleString("en-US");
  const amount = minor % 100 ? `${whole}.${(minor % 100).toString().padStart(2, "0")}` : whole;
  return currency === "GHS" ? `GH₵${amount}` : currency === "KES" ? `KSh ${amount}` : `$${amount}`;
}

// Country calling codes of the CFA franc countries: UEMOA (XOF) and CEMAC (XAF).
const XOF_CODES = ["221", "225", "229", "228", "223", "226", "227", "245"];
const XAF_CODES = ["237", "241", "242", "235", "236", "240"];

/**
 * The currency someone pays a plan in, going by their WhatsApp number:
 * naira for Nigeria, the local currency in Ghana, Kenya and the CFA
 * countries, US dollars anywhere else.
 */
export function payCurrencyFor(waId: string): PayCurrency {
  const n = waId.replace(/\D/g, "");
  if (n.startsWith("234")) return "NGN";
  if (n.startsWith("233")) return "GHS";
  if (n.startsWith("254")) return "KES";
  if (XOF_CODES.some((c) => n.startsWith(c))) return "XOF";
  if (XAF_CODES.some((c) => n.startsWith(c))) return "XAF";
  return "USD";
}

/**
 * A price typed by a person, in the business's currency, as whole hundredths:
 * "₦1,500" or "1500.50" in naira; "5 000", "5000 FCFA" or "5.000 F" in CFA
 * francs (whole francs only). Null for anything that isn't a plain amount,
 * including "15k", so a typo never becomes a price.
 */
export function parseMoney(text: string, currency: Currency = "NGN"): number | null {
  if (currency === "NGN") {
    const clean = text.replace(/^\s*(₦|ngn|n)\s*/i, "").replace(/[,\s]/g, "");
    const m = clean.match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  }
  const clean = text
    .replace(/\s*(f\s*cfa|fcfa|cfa|xof|xaf|francs?|f)\s*$/i, "")
    .replace(/^\s*(fcfa|cfa|xof|xaf)\s*/i, "")
    .replace(/[\s  .,']/g, "");
  if (!/^\d{1,10}$/.test(clean)) return null;
  return Number(clean) * 100;
}
