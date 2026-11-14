import type { Currency } from "../core/money.js";
import { formatMoney } from "../core/money.js";
import { DEFAULT_FEE_CAP } from "../products/quote/paylinks.js";
import type { Verification } from "./store.js";

// Anti-money-laundering checks on shops' pay links (see docs/AML_POLICY.md).
// The Money Laundering (Prevention and Prohibition) Act 2022 asks us to know
// who we deal with (s.4), watch for transactions out of line with a customer's
// business (s.4(3), s.7) and keep the records (s.8). These are the rules in
// code; Jay reviews what they flag on the compliance page.

// Words that say nothing about who owns an account.
const NOISE = new Set([
  "ltd", "limited", "plc", "llc", "enterprise", "enterprises", "venture", "ventures", "global", "nig", "nigeria",
  "service", "services", "and", "the", "of", "co", "company", "int", "international", "concept", "concepts",
  "store", "stores", "shop", "bn", "rc", "mr", "mrs", "miss", "ms", "dr", "chief", "alhaji", "alhaja", "engr", "pastor",
]);

/** The words in a name that identify someone: lower case, no punctuation or company words. */
export function nameTokens(name: string | null | undefined): string[] {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !NOISE.has(w));
}

/**
 * Whether two names are the same person or business: two words in common
 * (in any order, as banks often put the surname first), or the only word of
 * a one-word name.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return false;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common += 1;
  return common >= Math.min(2, ta.size, tb.size);
}

/** Whether the bank's name for the account is the verified business's or its owner's. */
export function bankMatches(accountName: string, v: Pick<Verification, "registeredName" | "directorName">): boolean {
  return namesMatch(accountName, v.registeredName) || namesMatch(accountName, v.directorName);
}

/**
 * Whether a shop can take payments above the unverified limits: yarnOga
 * approved it, hasn't paused it, and the account its money goes to is in the
 * verified name. `accountName` is null when the shop has no bank account on
 * file (its subaccount was made by hand), which can't be checked here.
 */
export function liftsLimits(v: Pick<Verification, "status" | "paused" | "registeredName" | "directorName">, accountName: string | null): boolean {
  return v.status === "approved" && !v.paused && (accountName === null || bankMatches(accountName, v));
}

// ---- Watching payments ----

export interface PaidPayment {
  amountKobo: number;
  paidAt: Date;
  waId: string;
}

export interface Flag {
  code: "big" | "near_limit" | "same_payer" | "jump";
  text: string;
}

const DAY = 86_400_000;

/**
 * What looks unusual in a shop's paid pay-link payments over the last five
 * weeks. Amounts scale with the currency, in steps of the fee cap (₦2,000):
 * - big: one payment of ₦5m or more in the last day (the Act's reporting line for individuals);
 * - near_limit: three or more payments of ₦180,000 to ₦200,000 in a week from an
 *   unverified shop, as if splitting to stay under the limit;
 * - same_payer: one customer paying five or more times in a day;
 * - jump: ₦500,000 or more in a week and over five times the shop's usual week.
 */
export function unusualPayments(paid: PaidPayment[], now: Date, opts: { currency: Currency; verified: boolean }): Flag[] {
  const unit = DEFAULT_FEE_CAP[opts.currency];
  const money = (minor: number) => formatMoney(minor, opts.currency);
  const t = now.getTime();
  const since = (days: number) => paid.filter((p) => t - p.paidAt.getTime() < days * DAY);
  const flags: Flag[] = [];

  const big = since(1).filter((p) => p.amountKobo >= unit * 2_500);
  if (big.length) flags.push({ code: "big", text: `A single payment of ${money(Math.max(...big.map((p) => p.amountKobo)))} in the last day.` });

  if (!opts.verified) {
    const near = since(7).filter((p) => p.amountKobo >= unit * 90 && p.amountKobo <= unit * 100);
    if (near.length >= 3) flags.push({ code: "near_limit", text: `${near.length} payments just under the ${money(unit * 100)} limit this week, while unverified.` });
  }

  const byPayer = new Map<string, number>();
  for (const p of since(1)) byPayer.set(p.waId, (byPayer.get(p.waId) ?? 0) + 1);
  const most = Math.max(0, ...byPayer.values());
  if (most >= 5) flags.push({ code: "same_payer", text: `One customer paid ${most} times in the last day.` });

  const week = since(7).reduce((s, p) => s + p.amountKobo, 0);
  const before = paid.filter((p) => t - p.paidAt.getTime() >= 7 * DAY && t - p.paidAt.getTime() < 35 * DAY).reduce((s, p) => s + p.amountKobo, 0);
  const usualWeek = before / 4;
  if (week >= unit * 250 && week > usualWeek * 5) {
    flags.push({ code: "jump", text: `${money(week)} this week against about ${money(Math.round(usualWeek))} in a usual week.` });
  }
  return flags;
}
