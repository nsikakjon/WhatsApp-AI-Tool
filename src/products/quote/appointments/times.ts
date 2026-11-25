// Days and times for appointment booking. Everything is Lagos time (UTC+1,
// no summer time), like the rest of the quote bot. A day is "2026-11-27"; a
// time of day is minutes after midnight (9:30am = 570).

export type Day = string;

const OFFSET_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const FULL_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The Lagos day, weekday (0 = Sunday) and minute of the day at this moment. */
export function lagos(at: Date): { day: Day; weekday: number; minute: number } {
  const local = new Date(at.getTime() + OFFSET_MS);
  return {
    day: local.toISOString().slice(0, 10),
    weekday: local.getUTCDay(),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** The moment it's `minute` minutes into `day` in Lagos. */
export function atLagos(day: Day, minute: number): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS + minute * 60_000);
}

export function addDays(day: Day, n: number): Day {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(day: Day): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** "Fri 27 Nov" */
export function showDay(day: Day): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "9:00am", "12:30pm" */
export function showTime(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** "Fri 27 Nov, 9:00am" */
export function showWhen(at: Date): string {
  const l = lagos(at);
  return `${showDay(l.day)}, ${showTime(l.minute)}`;
}

/** "Mon-Fri", "Sat", "Mon, Wed, Fri" */
export function showWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const run = sorted.length > 2 && sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (run) return `${WEEKDAYS[sorted[0]!]}-${WEEKDAYS[sorted[sorted.length - 1]!]}`;
  return sorted.map((d) => WEEKDAYS[d]).join(", ");
}

/** A weekday by name: "mon", "Monday", "tues". Null for anything else. */
function weekdayByName(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  const i = FULL_WEEKDAYS.findIndex((full) => full.startsWith(w));
  return i >= 0 ? i : null;
}

/**
 * Weekdays as owners write them: "Mon-Fri", "Mon Wed Fri", "Mon,Wed",
 * "weekdays", "weekends", "daily", "Sat". Null when it isn't days.
 */
export function readWeekdays(text: string): number[] | null {
  const t = text.trim().toLowerCase();
  if (/^(daily|every ?day|all week)$/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^weekdays?$/.test(t)) return [1, 2, 3, 4, 5];
  if (/^weekends?$/.test(t)) return [0, 6];
  const range = t.match(/^([a-z]+)\s*(?:-|to)\s*([a-z]+)$/);
  if (range) {
    const from = weekdayByName(range[1]!);
    const to = weekdayByName(range[2]!);
    if (from === null || to === null) return null;
    const days: number[] = [];
    for (let d = from; ; d = (d + 1) % 7) {
      days.push(d);
      if (d === to) break;
    }
    return days;
  }
  const words = t.split(/[\s,&]+|\band\b/).filter(Boolean);
  if (!words.length) return null;
  const days = words.map(weekdayByName);
  return days.every((d): d is number => d !== null) ? [...new Set(days)] : null;
}

/** "9", "9am", "9:30", "17:00", "2pm", "noon" as minutes after midnight. Null for anything else. */
export function readTime(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (t === "noon" || t === "midday") return 12 * 60;
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return null;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h * 60 + min;
}

/**
 * A range of hours: "9-5", "9am-5pm", "8:30-17:00", "9 to 1". A bare end
 * hour before the start is read as the afternoon, so 9-5 is 9am to 5pm.
 */
export function readHours(text: string): { start: number; end: number } | null {
  const m = text.trim().toLowerCase().match(/^(\S+?)\s*(?:-|–|to)\s*(\S+)$/);
  if (!m) return null;
  let start = readTime(m[1]!);
  let end = readTime(m[2]!);
  if (start === null || end === null) return null;
  // "1-3" is the afternoon: nobody books 1am to 3am. 6 and later stay mornings, for gyms.
  if (!/[ap]m$/.test(m[1]!) && !/[ap]m$/.test(m[2]!) && start < 6 * 60 && end <= 12 * 60) {
    start += 12 * 60;
    end += 12 * 60;
  }
  if (end <= start && !/[ap]m$/.test(m[2]!) && end + 12 * 60 > start) end += 12 * 60;
  if (end <= start || end > 24 * 60) return null;
  return { start, end };
}

/**
 * One day as an owner writes it, from today on: "today", "tomorrow", "Sat"
 * (the next Saturday, or today if it's Saturday), "27 Nov", "27/11".
 */
export function readDay(text: string, now: Date): Day | null {
  const t = text.trim().toLowerCase();
  const today = lagos(now).day;
  if (t === "today") return today;
  if (t === "tomorrow" || t === "tmr" || t === "tmrw") return addDays(today, 1);
  const weekday = /^[a-z]+$/.test(t) ? weekdayByName(t) : null;
  if (weekday !== null) return addDays(today, (weekday - weekdayOf(today) + 7) % 7);
  const named = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})$/);
  const slashed = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  let date: number | null = null;
  let month: number | null = null;
  if (named) {
    date = Number(named[1]);
    const i = MONTHS.findIndex((mo) => named[2]!.startsWith(mo.toLowerCase()));
    month = i >= 0 ? i : null;
  } else if (slashed) {
    date = Number(slashed[1]);
    month = Number(slashed[2]) - 1;
  }
  if (date === null || month === null || month < 0 || month > 11 || date < 1 || date > 31) return null;
  let year = Number(today.slice(0, 4));
  const candidate = (y: number) => `${y}-${String(month! + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  if (candidate(year) < today) year += 1;
  const day = candidate(year);
  // 31 Feb and the like.
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}
