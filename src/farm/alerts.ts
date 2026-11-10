import type { FarmStore, FieldRow } from "./store.js";
import type { SatelliteCache } from "./sat-cache.js";
import { farmRules, type FarmRules, type Insight } from "./rules.js";
import { fieldLocation, type FetchWeather } from "./weather.js";

// Oko's WhatsApp alerts. Once a day (in the morning, Nigeria time) the server
// works out "What needs attention" for every field whose owner switched alerts
// on, using the same rules the app shows (farm-app/js/crops.js), and sends the
// owner one WhatsApp message per field with anything new.
//
// Only the urgent alerts go out: the ones the app marks high (black pod risk,
// heavy rain coming, over-mature cassava...) and a satellite drop in
// greenness. Season reminders and scouting nudges stay in the app. The same
// alert isn't sent again for a field within a week.

export interface FieldAlertsDeps {
  store: FarmStore;
  /** Sends a WhatsApp message through the shared core (a template when the 24-hour window is closed). */
  send(to: string, text: string): Promise<void>;
  weather: FetchWeather;
  /** Satellite results, refreshed when old. Without it, the last saved results are used. */
  satellite?: SatelliteCache;
  /** The app's address, e.g. https://app.yarnoga.com/farm/ */
  appUrl?: string;
  rules?: FarmRules;
  now?: () => Date;
  log?: Pick<Console, "info" | "error">;
}

/** Hour of the day (Nigeria time) from which the day's alerts go out. */
export const ALERT_HOUR = 7;
export const REPEAT_DAYS = 7;
const LAGOS_OFFSET_MS = 3600_000; // West Africa Time, UTC+1 all year

export function createFieldAlerts(deps: FieldAlertsDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console;
  let doneOn: string | null = null;

  /** Checks one field and sends its new alerts. Returns the alerts sent. */
  async function checkField(field: FieldRow): Promise<Insight[]> {
    const rules = deps.rules ?? farmRules();
    if (field.deletedAt || field.data.kind === "land" || !field.data.crop) return [];
    const owner = await deps.store.user(field.ownerId);
    if (!owner || owner.disabled || !owner.phone) return [];
    const at = now();

    const loc = fieldLocation(field.data, rules.states);
    let wx: unknown = null;
    if (loc) {
      try {
        wx = await deps.weather(loc.lat, loc.lon);
      } catch (err) {
        log.error(`Farm alerts: no weather for field ${field.id}:`, err);
      }
    }
    let series = (await deps.store.satellite(field.id))?.series ?? null;
    if (deps.satellite) {
      const r = await deps.satellite.get(field).catch((error: unknown) => ({ kind: "failed" as const, error }));
      if (r.kind === "ok") series = r.row.series;
    }
    const data = { ...field.data, sat: series ? { series } : undefined };

    const urgent = rules.insights(data, wx, at).filter((i) => i.kind !== "scout" && (i.level === "high" || i.kind === "sat"));
    if (!urgent.length) return [];
    const recent = new Set(await deps.store.sentAlerts(field.id, new Date(at.getTime() - REPEAT_DAYS * 86400_000)));
    const fresh = urgent.filter((i) => !recent.has(i.title));
    if (!fresh.length) return [];

    await deps.send(owner.phone, alertMessage(fieldName(field), fresh, deps.appUrl));
    await deps.store.recordSentAlerts(field.id, fresh.map((i) => i.title), owner.phone, at);
    return fresh;
  }

  /** Runs the day's check once, after ALERT_HOUR Nigeria time. Call it every hour or so. */
  async function tick(): Promise<{ checked: number; sent: number } | null> {
    const lagos = new Date(now().getTime() + LAGOS_OFFSET_MS);
    const day = lagos.toISOString().slice(0, 10);
    if (doneOn === day || lagos.getUTCHours() < ALERT_HOUR) return null;
    doneOn = day;
    let checked = 0;
    let sent = 0;
    for (const id of await deps.store.alertFieldIds()) {
      try {
        const field = await deps.store.field(id);
        if (!field) continue;
        checked++;
        if ((await checkField(field)).length) sent++;
      } catch (err) {
        // One field's problem (a wrong number, WhatsApp busy) mustn't stop the others.
        log.error(`Farm alerts: field ${id} failed:`, err);
      }
    }
    if (checked) log.info(`Farm alerts: checked ${checked} field${checked === 1 ? "" : "s"}, sent ${sent} message${sent === 1 ? "" : "s"}`);
    return { checked, sent };
  }

  return { tick, checkField };
}

/** The WhatsApp message: the field, then each alert. Crop advice only, never chemical rates (those come from the label). */
export function alertMessage(field: string, alerts: Insight[], appUrl?: string): string {
  const lines = [`🌱 Oko: ${field} needs attention`, ""];
  for (const a of alerts) lines.push(`• *${a.title}*: ${a.text}`);
  if (appUrl) lines.push("", `Open the field: ${appUrl}`);
  lines.push("", "Switch these off in Oko > Settings > WhatsApp alerts.");
  return lines.join("\n");
}

function fieldName(f: FieldRow): string {
  const name = (f.data.f as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : "Your field";
}

/**
 * A WhatsApp number as digits with the country code (what WhatsApp calls a
 * wa_id), or null if it doesn't look like one. Nigerian numbers can be typed
 * the local way (0803 123 4567); others need their country code.
 */
export function waNumber(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  const d = digits.replace(/^\+/, "").replace(/^00/, "");
  if (/^0[789][01]\d{8}$/.test(d)) return `234${d.slice(1)}`;
  if (/^234[789][01]\d{8}$/.test(d)) return d;
  if (d.startsWith("234")) return null; // a Nigerian number with a digit missing or extra
  if ((digits.startsWith("+") || digits.startsWith("00")) && /^[1-9]\d{7,14}$/.test(d)) return d;
  return null;
}
