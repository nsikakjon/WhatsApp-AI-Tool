import type { SiteUpdate } from "./store.js";
import type { Summariser, Summary } from "./summarise.js";

// Building the daily progress report. Dates, times and counts are worked out
// here in code; the AI only sorts what staff said into sections.

// Lagos is UTC+1 all year (no daylight saving).
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** The Lagos calendar day for a moment, e.g. "2026-10-10". */
export function lagosDate(now: Date): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Lagos hour (0-23) for a moment. */
export function lagosHour(now: Date): number {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).getUTCHours();
}

/** Start and end of a Lagos calendar day, as real moments in time. */
export function lagosDayBounds(date: string): { from: Date; to: Date } {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  return {
    from: new Date(midnightUtc - LAGOS_OFFSET_MS),
    to: new Date(midnightUtc - LAGOS_OFFSET_MS + 24 * 60 * 60 * 1000),
  };
}

function lagosTime(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(11, 16);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "2026-10-10" -> "Sat 10 Oct 2026". */
export function displayDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatReport(siteName: string, date: string, updates: SiteUpdate[], summary: Summary | null): string {
  const heading = `*${siteName}: progress report for ${displayDate(date)}*`;
  if (updates.length === 0) {
    return `${heading}\n\nNo updates were sent from site today.`;
  }

  const people = new Set(updates.map((u) => u.memberName)).size;
  const photos = updates.filter((u) => u.kind === "photo").length;
  const counts = `${plural(updates.length, "update")} from ${people === 1 ? "1 person" : `${people} people`}, ${plural(photos, "photo")}`;

  if (!summary) {
    // The AI was unavailable: still send the raw updates so nothing is lost.
    const lines = updates
      .filter((u) => u.body)
      .map((u) => `• ${lagosTime(u.createdAt)} ${u.memberName}: ${u.body}`);
    return [heading, counts, "", "The summary couldn't be written today, so here are the updates as sent:", ...lines].join("\n");
  }

  const section = (title: string, items: string[]) => (items.length > 0 ? ["", `*${title}*`, ...items.map((i) => `• ${i}`)] : []);
  return [
    heading,
    counts,
    "",
    summary.overview,
    ...section("Work done", summary.workDone),
    ...section("Problems and delays", summary.problems),
    ...section("Materials needed", summary.materialsNeeded),
    ...section("Next steps", summary.nextSteps),
  ].join("\n");
}

/** Writes the report for one site and day from its updates. */
export async function buildReport(
  ai: Summariser,
  siteName: string,
  date: string,
  updates: SiteUpdate[],
  log: Pick<Console, "error"> = console,
): Promise<string> {
  let summary: Summary | null = null;
  if (updates.some((u) => u.body)) {
    try {
      summary = await ai.summarise({
        siteName,
        date: displayDate(date),
        updates: updates.map((u) => ({ time: lagosTime(u.createdAt), who: u.memberName, kind: u.kind, text: u.body })),
      });
    } catch (err) {
      log.error(`Site report summary failed for ${siteName}:`, err);
    }
  } else if (updates.length > 0) {
    // Only uncaptioned photos: nothing for the AI to read.
    summary = { overview: "Only photos were sent today, with no captions.", workDone: [], problems: [], materialsNeeded: [], nextSteps: [] };
  }
  return formatReport(siteName, date, updates, summary);
}
