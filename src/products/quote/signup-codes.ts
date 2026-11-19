// Finding a promo or referral code in what a new owner typed at sign-up:
// "TEDXUNIUYO is the referral code", "the code is tedx uniuyo", or a slip
// like "TEDxUNIU". Partner and promo codes forgive a short slip; a business's
// own referral code (KAHNP4821) must be exact, so one owner's slip never
// credits another owner.

export interface SignupCode {
  code: string;
  percentOff: number;
  /** How many businesses can use it, or null for no limit. */
  maxUses: number | null;
  /** Last day it can be used (Lagos date, YYYY-MM-DD), or null. */
  endsOn: string | null;
  /** A business's own referral code, which must be typed exactly. */
  personal: boolean;
}

/** "my referral code is ...", "promo", "discount". */
export const CODE_WORDS = /\b(code|referr?al|promo|coupon|discount)\b/i;

/** True when the message talks about a code or is one word, so it's worth looking one up. */
export function mentionsCode(text: string): boolean {
  return CODE_WORDS.test(text) || /^[a-z0-9]{4,20}$/i.test(text.replace(/\s+/g, ""));
}

/** The code the owner meant, or null when none (or more than one) fits. */
export function findCode(text: string, codes: SignupCode[]): SignupCode | null {
  const words = text.toUpperCase().match(/[A-Z0-9]{4,20}/g) ?? [];
  const joined = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const candidates = joined.length >= 4 && joined.length <= 20 && text.length <= 24 ? [...words, joined] : words;

  for (const word of candidates) {
    const exact = codes.find((c) => c.code === word);
    if (exact) return exact;
  }
  const near = codes.filter((c) => !c.personal && candidates.some((w) => closeTo(w, c.code)));
  return near.length === 1 ? near[0]! : null;
}

/** "Thanks, I've kept *TEDXUNIUYO*. It gives you 70% off your first month ..." */
// Everything in it comes from the code's own settings (dashboard Partnerships page or promo_codes).
export function codeKept(c: SignupCode): string {
  const terms = [
    c.maxUses ? `for the first ${c.maxUses} businesses` : "",
    c.endsOn ? `if you upgrade by ${formatDay(c.endsOn)}` : "",
  ].filter(Boolean);
  return (
    `Thanks, I've added your code *${c.code}*. It gives you ${c.percentOff}% off your first month on any paid plan${terms.length ? `, ${terms.join(", ")}` : ""}. ` +
    "You start on the Free plan, and the discount comes off automatically when you upgrade."
  );
}

/** A cut-off code (six letters or more of it) or one or two letters wrong. */
function closeTo(word: string, code: string): boolean {
  if (word.length >= 6 && code.startsWith(word)) return true;
  if (word.length < 5) return false;
  return distance(word, code) <= (code.length >= 8 ? 2 : 1);
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
