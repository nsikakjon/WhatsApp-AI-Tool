// Birthday dates: reading what admins type ("14 March", "14/03", "March 14th")
// and working out whose birthday it is today, in Lagos time.

export interface MonthDay {
  month: number; // 1-12
  day: number; // 1-31
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// French months without accents, as the text is compared once accents are taken off.
const MONTHS_FR = [
  "janvier", "fevrier", "mars", "avril", "mai", "juin",
  "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
];
const MONTHS_FR_SHOWN = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthFromWord(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  // "mar", "march" and "sept" all count.
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  if (i !== -1) return i + 1;
  // French: "fév", "sept", "déc"; "jui" could be juin or juillet, so it needs four letters.
  const fr = MONTHS_FR.findIndex((m) => m.startsWith(w) && (w.length >= 4 || !m.startsWith("jui")));
  return fr === -1 ? null : fr + 1;
}

function valid(month: number, day: number): MonthDay | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]!) return null;
  return { month, day };
}

/**
 * Finds a birthday in text. Numbers are read day first, as written in Nigeria
 * (14/03 is 14 March). A year, if given, is ignored. Returns null if there's
 * no clear date.
 */
export function parseBirthday(text: string): MonthDay | null {
  // Accents off, so "14 février" and "1er août" read like "14 fevrier" and "1er aout".
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 14/03, 14-3, 14.03.1990
  const numeric = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?\b/);
  if (numeric) return valid(Number(numeric[2]), Number(numeric[1]));

  // 14 March, 14th of March, 14 Mar 1990, 1er mars
  const dayFirst = t.match(/\b(\d{1,2})(?:st|nd|rd|th|er)?(?:\s+of)?\s+([a-z]+\.?)/);
  if (dayFirst) {
    const month = monthFromWord(dayFirst[2]!);
    if (month) return valid(month, Number(dayFirst[1]));
  }

  // March 14, Mar 14th
  const monthFirst = t.match(/\b([a-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (monthFirst) {
    const month = monthFromWord(monthFirst[1]!);
    if (month) return valid(month, Number(monthFirst[2]));
  }

  return null;
}

/** "14 March", or in French "14 mars" and "1er mars". */
export function formatMonthDay({ month, day }: MonthDay, lang: "en" | "fr" = "en"): string {
  if (lang === "fr") return `${day === 1 ? "1er" : day} ${MONTHS_FR_SHOWN[month - 1]!}`;
  const name = MONTHS[month - 1]!;
  return `${day} ${name[0]!.toUpperCase()}${name.slice(1)}`;
}

// Nigeria is UTC+1 all year (no daylight saving).
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** Today's date and hour in Lagos. */
export function lagosNow(now: Date): { year: number; month: number; day: number; hour: number } {
  const t = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours() };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The birthdays to celebrate on this date. Usually just today's, but on
 * 28 February in a non-leap year it also includes 29 February birthdays.
 */
export function birthdaysCelebratedOn(year: number, month: number, day: number): MonthDay[] {
  const dates = [{ month, day }];
  if (month === 2 && day === 28 && !isLeapYear(year)) dates.push({ month: 2, day: 29 });
  return dates;
}

/** Days from today until the next time this birthday is celebrated (0 = today). */
export function daysUntil(birthday: MonthDay, today: { year: number; month: number; day: number }): number {
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1, today.year + 2]) {
    let { month, day } = birthday;
    if (month === 2 && day === 29 && !isLeapYear(year)) day = 28;
    const at = Date.UTC(year, month - 1, day);
    if (at >= start) return Math.round((at - start) / 86_400_000);
  }
  return 365;
}
