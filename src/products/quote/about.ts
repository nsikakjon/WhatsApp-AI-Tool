import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "../../core/i18n.js";

// "About us": what the owner writes about the business (address, opening
// hours, delivery days, policies). The AI answers customers' questions from
// it, and the bot tells customers when the shop is closed. Prices never come
// from here: the AI still can't put an amount in a reply.

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

/** Opening and closing time ("08:00", "18:00") for each open day; a missing day is closed. */
export type OpeningHours = Partial<Record<Day, [string, string]>>;

export interface BusinessAbout {
  text: string | null;
  hours: OpeningHours | null;
}

const DAY_NAMES: Record<Lang, Record<Day, string>> = {
  en: { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" },
  fr: { sun: "dimanche", mon: "lundi", tue: "mardi", wed: "mercredi", thu: "jeudi", fri: "vendredi", sat: "samedi" },
  pcm: { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" },
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Opening hours as typed in the app, keeping only well-formed days where closing is after opening. */
export function cleanHours(raw: unknown): OpeningHours | null {
  if (!raw || typeof raw !== "object") return null;
  const out: OpeningHours = {};
  for (const day of DAYS) {
    const v = (raw as Record<string, unknown>)[day];
    if (Array.isArray(v) && TIME.test(String(v[0])) && TIME.test(String(v[1])) && String(v[0]) < String(v[1])) {
      out[day] = [String(v[0]), String(v[1])];
    }
  }
  return Object.keys(out).length ? out : null;
}

/** The day and minutes since midnight, in Lagos time (UTC+1). */
function lagosClock(now: Date): { day: number; minutes: number } {
  const t = new Date(now.getTime() + 60 * 60_000);
  return { day: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Open now and when it closes today, or closed with when it next opens (null when no hours are set). */
export function openState(hours: OpeningHours | null, now: Date): { open: true; closes: string } | { open: false; next: { day: Day; time: string; today: boolean; tomorrow: boolean } | null } | null {
  if (!hours) return null;
  const { day, minutes: m } = lagosClock(now);
  const today = hours[DAYS[day]!];
  if (today && m >= minutes(today[0]) && m < minutes(today[1])) return { open: true, closes: today[1] };
  for (let ahead = 0; ahead < 8; ahead++) {
    const d = DAYS[(day + ahead) % 7]!;
    const slot = hours[d];
    if (!slot || (ahead === 0 && m >= minutes(slot[0]))) continue;
    return { open: false, next: { day: d, time: slot[0], today: ahead === 0, tomorrow: ahead === 1 } };
  }
  return { open: false, next: null };
}

/** "Monday to Friday 08:00–18:00; Saturday 10:00–16:00; Sunday closed". */
export function hoursText(hours: OpeningHours, lang: Lang = "en"): string {
  const names = DAY_NAMES[lang];
  const closed = lang === "fr" ? "fermé" : "closed";
  const order: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const groups: Array<{ from: Day; to: Day; slot: string }> = [];
  for (const d of order) {
    const slot = hours[d] ? `${hours[d]![0]}–${hours[d]![1]}` : closed;
    const last = groups.at(-1);
    if (last && last.slot === slot) last.to = d;
    else groups.push({ from: d, to: d, slot });
  }
  const to = lang === "fr" ? "au" : "to";
  return groups.map((g) => `${g.from === g.to ? cap(names[g.from], lang) : `${cap(names[g.from], lang)} ${to} ${names[g.to]}`} ${g.slot}`).join("; ");
}

function cap(word: string, lang: Lang): string {
  return lang === "fr" ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** When it next opens, in words: "at 08:00 tomorrow", "on Monday at 08:00". */
export function nextOpenText(next: { day: Day; time: string; today: boolean; tomorrow: boolean }, lang: Lang = "en"): string {
  if (lang === "fr") return next.today ? `aujourd'hui à ${next.time}` : next.tomorrow ? `demain à ${next.time}` : `${DAY_NAMES.fr[next.day]} à ${next.time}`;
  if (lang === "pcm") return next.today ? `today by ${next.time}` : next.tomorrow ? `tomorrow by ${next.time}` : `on ${DAY_NAMES.pcm[next.day]} by ${next.time}`;
  return next.today ? `today at ${next.time}` : next.tomorrow ? `tomorrow at ${next.time}` : `on ${DAY_NAMES.en[next.day]} at ${next.time}`;
}

/** The About section as the AI sees it. */
export function aboutForAi(about: BusinessAbout | null): string | null {
  if (!about) return null;
  const parts = [about.text?.trim(), about.hours ? `Opening hours (Lagos time): ${hoursText(about.hours)}.` : null].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

/** Reads the About section at most once a minute, so owners' changes show up quickly without a database call per message. */
export function cachedAbout(load: () => Promise<BusinessAbout | null>, ttlMs = 60_000): () => Promise<BusinessAbout | null> {
  let at = 0;
  let value: BusinessAbout | null = null;
  return async () => {
    if (Date.now() - at < ttlMs) return value;
    try {
      value = await load();
    } catch (err) {
      console.error("Could not read the business's About section:", err);
    }
    at = Date.now();
    return value;
  };
}

/** The About section from the business's row (migration 0054). */
export function createSupabaseAbout(db: SupabaseClient, businessId: string): () => Promise<BusinessAbout | null> {
  return async () => {
    const { data, error } = await db.from("quote_businesses").select("*").eq("id", businessId).maybeSingle();
    if (error) throw new Error(`about lookup failed: ${error.message}`);
    if (!data) return null;
    const text = typeof data.about === "string" && data.about.trim() ? data.about.trim() : null;
    const hours = cleanHours(data.opening_hours);
    return text || hours ? { text, hours } : null;
  };
}
