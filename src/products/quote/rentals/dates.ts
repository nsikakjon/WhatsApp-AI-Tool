// Reads hire dates out of what a customer wrote, in code (no AI), so the
// days charged always come from the dates themselves:
//   "from Friday for 3 days", "27 Nov to 30 Nov", "27th-30th", "27/11 till 2/12",
//   "tomorrow for a week", "this weekend", "2 weeks from 1 Dec".
// Dates are Lagos calendar days written "2026-11-27". A hire goes out on
// `start` and comes back on `back`, so it is out for back - start days.

export type Day = string;

export type HireDates =
  | { start: Day; back: Day }
  /** A start day but no length or end yet. */
  | { start: Day; back: null }
  /** A length but no start day yet. */
  | { start: null; days: number };

const DAY_MS = 86_400_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MAX_DAYS = 366;

/** Today in Lagos (UTC+1, no daylight saving). */
export function lagosToday(now: Date): Day {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "Fri 27 Nov" */
export function showDay(day: Day): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b`;
const ORD = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const WEEKDAY = String.raw`(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thurs?|thu|fri|sat)\b`;
/** One date as written. Groups: 1 day + 2 month name | 3 month name + 4 day | 5 d + 6 m + 7 year | 8 relative | 9 next? + 10 weekday | 11 bare day */
const DATE = String.raw`\b(?:${ORD}(?:\s+of)?\s+${MONTH}|${MONTH}\s+${ORD}|(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?|(today|tomorrow|tmrw|tmr)|(next\s+|this\s+)?${WEEKDAY}|${ORD}(?![\d/]))`;
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14, thirty: 30 };
const LENGTH = /\b(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty)\s*(days?|weeks?|wks?|months?)\b/i;

interface Found {
  day: Day;
  /** Only a day of the month was written ("27th"): its month comes from the other date. */
  bare?: number;
  index: number;
  end: number;
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

/** The first date on or after today with this day and month. */
function upcoming(today: Day, day: number, month: number, year?: number): Day | null {
  const y = Number(today.slice(0, 4));
  for (const candidate of year ? [year] : [y, y + 1]) {
    const d = new Date(Date.UTC(candidate, month, day));
    if (d.getUTCMonth() !== month) return null;
    const iso = d.toISOString().slice(0, 10);
    if (year || iso >= today) return iso;
  }
  return null;
}

function readDate(m: RegExpExecArray, today: Day): Found | null {
  const at = { index: m.index, end: m.index + m[0].length };
  if (m[1] && m[2]) return withDay(upcoming(today, Number(m[1]), monthIndex(m[2])), at);
  if (m[3] && m[4]) return withDay(upcoming(today, Number(m[4]), monthIndex(m[3])), at);
  if (m[5] && m[6]) {
    const year = m[7] ? Number(m[7].length === 2 ? `20${m[7]}` : m[7]) : undefined;
    return withDay(upcoming(today, Number(m[5]), Number(m[6]) - 1, year), at);
  }
  if (m[8]) return { day: m[8].toLowerCase() === "today" ? today : addDays(today, 1), ...at };
  if (m[10]) {
    const want = WEEKDAYS.indexOf(m[10].slice(0, 3).toLowerCase());
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    let ahead = (want - now + 7) % 7;
    if (m[9]?.trim().toLowerCase() === "next" && ahead === 0) ahead = 7;
    return { day: addDays(today, ahead), ...at };
  }
  if (m[11]) {
    const n = Number(m[11]);
    if (n < 1 || n > 31) return null;
    const month = Number(today.slice(5, 7)) - 1;
    const day = upcoming(today, n, month) ?? upcoming(today, n, (month + 1) % 12);
    return day ? { day, bare: n, ...at } : null;
  }
  return null;
}

function withDay(day: Day | null, at: { index: number; end: number }): Found | null {
  return day ? { day, ...at } : null;
}

function lengthInDays(text: string): number | null {
  const m = text.match(LENGTH);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!.toLowerCase()]!;
  const unit = m[2]!.toLowerCase();
  const days = unit.startsWith("w") ? n * 7 : unit.startsWith("m") ? n * 30 : n;
  return days >= 1 && days <= MAX_DAYS ? days : null;
}

/** The hire dates in a message, or null when it names none. */
export function readHireDates(text: string, now: Date): HireDates | null {
  const today = lagosToday(now);
  const clean = text.toLowerCase().replace(/[’']/g, "");
  if (/\b(this|next|the)\s+weekend\b|\bweekend\b/.test(clean)) {
    const sat = (6 - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
    const start = addDays(today, /\bnext\s+weekend\b/.test(clean) ? sat + 7 : sat);
    return { start, back: addDays(start, 2) };
  }
  // A length like "3 days" is not a date, so it's taken out first ("3" would read as the 3rd).
  const days = lengthInDays(clean);
  const dateText = clean.replace(new RegExp(LENGTH.source, "gi"), (s) => " ".repeat(s.length)).replace(/\b\d{1,2}\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b\d+\s*kva\b|\b\d{3,}\b/g, (s) => " ".repeat(s.length));
  const found: Found[] = [];
  const re = new RegExp(DATE, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(dateText)) && found.length < 2) {
    // A bare number counts only next to a date word ("27th", "from 27 to 30 nov"), not "2 generators".
    if (m[11] && !/(st|nd|rd|th)$/.test(m[0]) && !/\b(from|on|to|till|until|of|-|–)\s*$/.test(dateText.slice(0, m.index)) && !/^\s*(-|–|to|till|until)\b/.test(dateText.slice(m.index + m[0].length))) continue;
    const date = readDate(m, today);
    if (date) found.push(date);
  }
  const [first, second] = found;
  if (first && second) {
    // "27th to 30th Nov": the bare day takes the other's month.
    let start = first.day;
    if (first.bare !== undefined && second.bare === undefined) {
      start = upcoming(today, first.bare, Number(second.day.slice(5, 7)) - 1, Number(second.day.slice(0, 4))) ?? first.day;
    }
    let back = second.day;
    if (second.bare !== undefined && first.bare === undefined) {
      back = upcoming(start, second.bare, Number(start.slice(5, 7)) - 1) ?? upcoming(start, second.bare, Number(start.slice(5, 7)) % 12) ?? second.day;
    }
    while (back < start) back = addDays(back, 365);
    // "27 to 27 Nov" is one day; anything longer than a year is a misread.
    if (back === start) back = addDays(start, 1);
    return daysBetween(start, back) <= MAX_DAYS ? { start, back } : null;
  }
  if (first) return days ? { start: first.day, back: addDays(first.day, days) } : { start: first.day, back: null };
  return days ? { start: null, days } : null;
}
