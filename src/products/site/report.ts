import type { SharedLocation } from "../../core/whatsapp/types.js";
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

export function lagosTime(at: Date): string {
  return new Date(at.getTime() + LAGOS_OFFSET_MS).toISOString().slice(11, 16);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "2026-10-10" -> "Sat 10 Oct 2026". */
export function displayDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** A Google Maps link that opens the pin. Coordinates are rounded to about 1 metre. */
export function mapsLink(loc: SharedLocation): string {
  return `https://maps.google.com/?q=${loc.latitude.toFixed(5)},${loc.longitude.toFixed(5)}`;
}

/** The place's name and address if WhatsApp gave them, otherwise the coordinates. */
export function placeLabel(loc: SharedLocation): string {
  const named = [loc.name, loc.address].filter(Boolean).join(", ");
  return named || `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
}

/** The day's numbers, e.g. "3 updates from 2 people, 2 photos, 1 location". Counted in code. */
export function reportCounts(updates: SiteUpdate[]): string {
  const people = new Set(updates.map((u) => u.memberName)).size;
  const photos = updates.filter((u) => u.kind === "photo").length;
  const locations = updates.filter((u) => u.kind === "location").length;
  return [
    `${plural(updates.length, "update")} from ${people === 1 ? "1 person" : `${people} people`}`,
    plural(photos, "photo"),
    ...(locations > 0 ? [plural(locations, "location")] : []),
  ].join(", ");
}

/** The location pins sent during the day, in order. */
export function locationsOf(updates: SiteUpdate[]): Array<SiteUpdate & { location: SharedLocation }> {
  return updates.filter((u): u is SiteUpdate & { location: SharedLocation } => u.kind === "location" && !!u.location);
}

export function formatReport(siteName: string, date: string, updates: SiteUpdate[], summary: Summary | null): string {
  const heading = `*${siteName}: progress report for ${displayDate(date)}*`;
  if (updates.length === 0) {
    return `${heading}\n\nNo updates were sent from site today.`;
  }

  const counts = reportCounts(updates);
  const section = (title: string, items: string[]) => (items.length > 0 ? ["", `*${title}*`, ...items.map((i) => `• ${i}`)] : []);
  const locations = section(
    "Locations shared",
    locationsOf(updates).map((u) => `${lagosTime(u.createdAt)} ${u.memberName}: ${placeLabel(u.location)}\n  ${mapsLink(u.location)}`),
  );

  if (!summary) {
    // The AI was unavailable: still send the raw updates so nothing is lost.
    const lines = updates
      .filter((u) => u.body)
      .map((u) => `• ${lagosTime(u.createdAt)} ${u.memberName}: ${u.body}`);
    return [heading, counts, "", "The summary couldn't be written today, so here are the updates as sent:", ...lines, ...locations].join("\n");
  }

  return [
    heading,
    counts,
    "",
    summary.overview,
    ...section("Work done", summary.workDone),
    ...section("Problems and delays", summary.problems),
    ...section("Materials needed", summary.materialsNeeded),
    ...section("Next steps", summary.nextSteps),
    ...locations,
  ].join("\n");
}

/** One site's report for one day: the WhatsApp text plus what the PDF needs. */
export interface DailyReport {
  siteName: string;
  /** e.g. "2026-10-10" (Lagos). */
  date: string;
  updates: SiteUpdate[];
  /** null when the AI couldn't write the summary (or there was nothing to summarise). */
  summary: Summary | null;
  text: string;
}

/** Writes the report for one site and day from its updates. */
export async function buildReport(
  ai: Summariser,
  siteName: string,
  date: string,
  updates: SiteUpdate[],
  log: Pick<Console, "error"> = console,
): Promise<DailyReport> {
  let summary: Summary | null = null;
  if (updates.some((u) => u.body)) {
    try {
      summary = await ai.summarise({
        siteName,
        date: displayDate(date),
        updates: updates.map((u) => ({
          time: lagosTime(u.createdAt),
          who: u.memberName,
          kind: u.kind,
          text: u.kind === "location" && u.location ? placeLabel(u.location) : u.body,
        })),
      });
    } catch (err) {
      log.error(`Site report summary failed for ${siteName}:`, err);
    }
  } else if (updates.length > 0) {
    // Only uncaptioned photos and location pins: nothing for the AI to read.
    const overview = updates.some((u) => u.kind === "location")
      ? "Only photos and location pins were sent today, with no written updates."
      : "Only photos were sent today, with no captions.";
    summary = { overview, workDone: [], problems: [], materialsNeeded: [], nextSteps: [] };
  }
  return { siteName, date, updates, summary, text: formatReport(siteName, date, updates, summary) };
}
