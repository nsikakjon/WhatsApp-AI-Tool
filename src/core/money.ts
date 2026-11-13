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
 * the currency's hundredths (kobo for naira, centimes for CFA francs, cents
 * for shillings), so the same integer columns and sums work for every currency.
 *   NGN  Nigerian naira
 *   XOF  West African CFA franc (Senegal, Côte d'Ivoire, Benin, Togo, Mali, Burkina Faso, Niger, Guinea-Bissau)
 *   XAF  Central African CFA franc (Cameroon, Gabon, Congo, Chad, Central African Republic, Equatorial Guinea)
 *   GHS  Ghana cedi           ZMW  Zambian kwacha
 *   KES  Kenyan shilling      UGX  Ugandan shilling      TZS  Tanzanian shilling
 *   RWF  Rwandan franc        MWK  Malawian kwacha
 * Only naira prices have kobo. Every other currency is priced in whole units
 * (whole cedis, francs, shillings or kwacha), the way shops there price things.
 */
export type Currency = "NGN" | "XOF" | "XAF" | "GHS" | "ZMW" | "KES" | "UGX" | "TZS" | "RWF" | "MWK";
export const CURRENCIES: Currency[] = ["NGN", "XOF", "XAF", "GHS", "ZMW", "KES", "UGX", "TZS", "RWF", "MWK"];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as string[]).includes(value);
}

/** True for the two CFA francs, which are written the French way ("5 000 FCFA"). */
export function isCfa(currency: Currency | PayCurrency): currency is "XOF" | "XAF" {
  return currency === "XOF" || currency === "XAF";
}

// How cedi, kwacha and shilling amounts are written: the sign first, commas
// between thousands. `before` is the sign with any space after it.
const LOCAL: Record<string, { sign: string; before: string; en: string; fr: string }> = {
  GHS: { sign: "GH₵", before: "GH₵", en: "Ghana cedis", fr: "cedis ghanéens" },
  ZMW: { sign: "K", before: "K", en: "Zambian kwacha", fr: "kwacha zambiens" },
  KES: { sign: "KSh", before: "KSh ", en: "Kenyan shillings", fr: "shillings kényans" },
  UGX: { sign: "USh", before: "USh ", en: "Ugandan shillings", fr: "shillings ougandais" },
  TZS: { sign: "TSh", before: "TSh ", en: "Tanzanian shillings", fr: "shillings tanzaniens" },
  RWF: { sign: "RWF", before: "RWF ", en: "Rwandan francs", fr: "francs rwandais" },
  MWK: { sign: "MK", before: "MK ", en: "Malawian kwacha", fr: "kwacha malawites" },
};

/** The currency's sign as people write it next to a price: "₦", "FCFA", "KSh" and so on. */
export function currencySign(currency: Currency): string {
  if (isCfa(currency)) return "FCFA";
  return LOCAL[currency]?.sign ?? "₦";
}

/** The currency's name in a sentence, e.g. "fee in naira", "frais en francs CFA" or "Kenyan shillings". */
export function currencyName(currency: Currency, lang: Lang = "en"): string {
  if (isCfa(currency)) return lang === "fr" ? "francs CFA" : "CFA francs";
  return LOCAL[currency]?.[lang === "fr" ? "fr" : "en"] ?? "naira";
}

/**
 * How a page's own script writes amounts: sign before or after, the thousands
 * separator and the decimal mark. Matches formatMoney.
 */
export function moneyStyle(currency: Currency): { before: string; after: string; thousands: string; decimal: string } {
  if (isCfa(currency)) return { before: "", after: "\u00a0FCFA", thousands: "\u00a0", decimal: "," };
  return { before: LOCAL[currency]?.before ?? "₦", after: "", thousands: ",", decimal: "." };
}

/**
 * Formats an amount for display: 1250000 -> "₦12,500" in naira,
 * 500000 -> "5 000 FCFA" in CFA francs (the French way, with a space every
 * three digits and FCFA after the number) and 150000 -> "KSh 1,500" in
 * Kenyan shillings.
 */
export function formatMoney(minor: number, currency: Currency = "NGN"): string {
  if (!isCurrency(currency) || currency === "NGN") return formatNaira(minor);
  assertKobo(minor);
  const style = moneyStyle(currency);
  const units = Math.floor(minor / 100);
  const rest = minor % 100;
  const whole = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, style.thousands);
  return `${style.before}${whole}${rest ? `${style.decimal}${rest.toString().padStart(2, "0")}` : ""}${style.after}`;
}

/**
 * The currencies yarnOga's own plans can be paid in: any Currency or US
 * dollars, at fixed prices from the plan_prices table (migrations 0062, 0074
 * and 0086). Amounts are hundredths here too (cents).
 */
export type PayCurrency = Currency | "USD";

export function isPayCurrency(value: unknown): value is PayCurrency {
  return isCurrency(value) || value === "USD";
}

/** Formats a plan payment: "₦7,000", "3 500 FCFA", "GH₵70", "K150", "KSh 850" or "$5.50". */
export function formatPayMoney(minor: number, currency: PayCurrency): string {
  if (isCurrency(currency)) return formatMoney(minor, currency);
  assertKobo(minor);
  const whole = Math.floor(minor / 100).toLocaleString("en-US");
  return `$${minor % 100 ? `${whole}.${(minor % 100).toString().padStart(2, "0")}` : whole}`;
}

// Country calling codes of the CFA franc countries: UEMOA (XOF) and CEMAC (XAF).
const XOF_CODES = ["221", "225", "229", "228", "223", "226", "227", "245"];
const XAF_CODES = ["237", "241", "242", "235", "236", "240"];

/**
 * The currency someone pays a plan in, going by their WhatsApp number:
 * naira for Nigeria, the local currency in Ghana, Zambia, Kenya, Rwanda,
 * Uganda, Tanzania, Malawi and the CFA countries, US dollars anywhere else.
 */
export function payCurrencyFor(waId: string): PayCurrency {
  const n = waId.replace(/\D/g, "");
  if (n.startsWith("234")) return "NGN";
  if (n.startsWith("233")) return "GHS";
  if (n.startsWith("260")) return "ZMW";
  if (n.startsWith("254")) return "KES";
  if (n.startsWith("250")) return "RWF";
  if (n.startsWith("256")) return "UGX";
  if (n.startsWith("255")) return "TZS";
  if (n.startsWith("265")) return "MWK";
  if (XOF_CODES.some((c) => n.startsWith(c))) return "XOF";
  if (XAF_CODES.some((c) => n.startsWith(c))) return "XAF";
  return "USD";
}

/**
 * A price typed by a person, in the business's currency, as whole hundredths:
 * "₦1,500" or "1500.50" in naira; "5 000", "5000 FCFA" or "5.000 F" in CFA
 * francs; "KSh 1,500", "1500/=" or "1,500.00" in shillings, Rwandan francs or
 * kwacha (whole units only outside naira). Null for anything that isn't a
 * plain amount, including "15k", so a typo never becomes a price.
 */
export function parseMoney(text: string, currency: Currency = "NGN"): number | null {
  if (currency === "NGN") {
    const clean = text.replace(/^\s*(₦|ngn|n)\s*/i, "").replace(/[,\s]/g, "");
    const m = clean.match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  }
  if (isCfa(currency)) {
    const clean = text
      .replace(/\s*(f\s*cfa|fcfa|cfa|xof|xaf|francs?|f)\s*$/i, "")
      .replace(/^\s*(fcfa|cfa|xof|xaf)\s*/i, "")
      .replace(/[\s  .,']/g, "");
    if (!/^\d{1,10}$/.test(clean)) return null;
    return Number(clean) * 100;
  }
  const clean = text
    .replace(/^\s*(gh₵|gh¢|ghs|¢|ksh|kes|ush|ugx|tsh|tzs|rwf|frw|mk|mwk|zmw|sh|k)\.?\s*/i, "")
    .replace(/\s*(\/=|\/-|ghs|cedis?|ksh|kes|ush|ugx|tsh|tzs|rwf|frw|mk|mwk|zmw|shillings?|francs?|kwacha)\s*$/i, "")
    .replace(/\.0{1,2}$/, "")
    .replace(/[\s,]/g, "");
  if (!/^\d{1,10}$/.test(clean)) return null;
  return Number(clean) * 100;
}
