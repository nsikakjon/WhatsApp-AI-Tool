import { assertKobo } from "../../../core/money.js";

// What a hire costs, worked out in code from the rates saved in the
// database. All amounts are kobo (whole numbers).

export interface Rates {
  dailyKobo: number;
  /** Price for 7 days; null when every day is charged at the daily rate. */
  weeklyKobo: number | null;
}

/**
 * The charge for one unit for `days` days. With a weekly rate, each full week
 * is charged at the weekly rate and the days left over at the daily rate, but
 * never more than another week would cost.
 */
export function hireCharge(days: number, rates: Rates): number {
  if (!Number.isSafeInteger(days) || days < 1) throw new Error(`Hire days must be a whole number of at least 1 (got ${days})`);
  const daily = assertKobo(rates.dailyKobo, "daily rate");
  if (rates.weeklyKobo === null) return assertKobo(daily * days, "hire charge");
  const weekly = assertKobo(rates.weeklyKobo, "weekly rate");
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  return assertKobo(weeks * weekly + Math.min(rest * daily, weekly), "hire charge");
}

export interface ReturnCheck {
  /** The deposit paid for this booking (all units), in kobo. */
  depositKobo: number;
  /** Days after the return date it came back; 0 when on time. */
  lateDays: number;
  units: number;
  rates: Rates;
  /** What staff charged for damage or missing parts, in kobo. */
  damageKobo: number;
}

export interface Settlement {
  lateKobo: number;
  damageKobo: number;
  /** Deposit to give back. */
  refundKobo: number;
  /** What the customer still owes once the deposit is used up. */
  balanceKobo: number;
}

/** Late days and damage come off the deposit; the rest goes back, or the customer pays the difference. */
export function settleReturn(check: ReturnCheck): Settlement {
  const lateKobo = check.lateDays > 0 ? assertKobo(hireCharge(check.lateDays, check.rates) * check.units, "late charge") : 0;
  const damageKobo = assertKobo(check.damageKobo, "damage charge");
  const owed = lateKobo + damageKobo;
  const deposit = assertKobo(check.depositKobo, "deposit");
  return { lateKobo, damageKobo, refundKobo: Math.max(deposit - owed, 0), balanceKobo: Math.max(owed - deposit, 0) };
}
