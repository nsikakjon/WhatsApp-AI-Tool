// Field weather for Oko, fetched by the server from Open-Meteo and handed to
// phones through /farm/api/weather.
//
// Why through the server: Open-Meteo's free service is for non-commercial use
// only. When Oko goes public we switch to their paid plan, and the paid key
// must never reach a phone. Going through the server also means fields that
// sit close together (the same ~1 km square) share one answer, so Open-Meteo
// is asked far less often.
//
//   - No OPEN_METEO_API_KEY: the free service (fine for the private trial).
//   - OPEN_METEO_API_KEY set: the paid "customer" service, with the key.
//
// The phone still keeps its own copy of the last answer, so weather shows
// with no signal on the farm.

export interface WeatherConfig {
  /** A paid Open-Meteo API key. Without one, the free service is used. */
  apiKey?: string;
}

export type WeatherProvider = "open-meteo-free" | "open-meteo-paid";

/** What the phone stores as a field's weather (minus the time it fetched it). */
export interface FieldWeather {
  key: string;
  current: Record<string, unknown>;
  daily: Record<string, unknown[]>;
  /** Average humidity for each day in `daily.time`. */
  rhDaily: Array<number | null>;
  /** Soil moisture 3–9 cm now (m³/m³), when known. */
  soil: number | null;
}

export interface MonthlyRain {
  key: string;
  /** [YYYY-MM, millimetres], oldest first. */
  months: Array<[string, number]>;
}

const FORECAST_MS = 60 * 60_000; // the forecast model updates about hourly
const MONTHLY_MS = 24 * 3600_000; // past months don't change
const MAX_ENTRIES = 2000;

export type Fetch = typeof fetch;

/** Rounds to 2 decimals (about 1 km), the size of square that shares a forecast. */
export const squareKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export function createWeather(cfg: WeatherConfig = {}, fetchFn: Fetch = fetch, now: () => number = Date.now) {
  const key = cfg.apiKey?.trim() || "";
  const provider: WeatherProvider = key ? "open-meteo-paid" : "open-meteo-free";
  const host = (name: "api" | "archive-api") => `https://${key ? `customer-${name}` : name}.open-meteo.com`;
  const withKey = (u: string) => (key ? `${u}&apikey=${encodeURIComponent(key)}` : u);

  const cache = new Map<string, { at: number; value: unknown }>();
  const busy = new Map<string, Promise<unknown>>();

  /** A cached answer if it's fresh enough, otherwise ask once (shared by requests made at the same time). */
  async function cached<T>(id: string, maxAge: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(id);
    if (hit && now() - hit.at < maxAge) return hit.value as T;
    let job = busy.get(id) as Promise<T> | undefined;
    if (!job) {
      job = load()
        .then((value) => {
          cache.delete(id);
          cache.set(id, { at: now(), value });
          while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
          return value;
        })
        .finally(() => busy.delete(id));
      busy.set(id, job);
    }
    try {
      return await job;
    } catch (err) {
      if (hit) return hit.value as T; // Open-Meteo is down: an older answer beats none
      throw err;
    }
  }

  async function getJson(url: string): Promise<any> {
    const res = await fetchFn(withKey(url));
    if (!res.ok) {
      const hint = key && (res.status === 400 || res.status === 401 || res.status === 403) ? " Check OPEN_METEO_API_KEY." : "";
      throw new Error(`Open-Meteo answered ${res.status}.${hint}`);
    }
    return res.json();
  }

  return {
    provider,

    /** The last 31 days and next 8 days for the ~1 km square around a point. */
    forecast(lat: number, lon: number): Promise<FieldWeather> {
      const k = squareKey(lat, lon);
      const [la, lo] = k.split(",");
      return cached(`f:${k}`, FORECAST_MS, async () => {
        const j = await getJson(
          `${host("api")}/v1/forecast?latitude=${la}&longitude=${lo}` +
            `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
            `&hourly=relative_humidity_2m,soil_moisture_3_to_9cm` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration` +
            `&past_days=31&forecast_days=8&timezone=Africa%2FLagos`,
        );
        return summariseForecast(k, j);
      });
    },

    /** Rain for each of the last 12 months (this month so far included). */
    monthly(lat: number, lon: number): Promise<MonthlyRain> {
      const k = squareKey(lat, lon);
      const [la, lo] = k.split(",");
      const end = new Date(now() - 6 * 86400_000); // the archive runs about 5 days behind
      const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      return cached(`m:${k}:${ymd(end)}`, MONTHLY_MS, async () => {
        const j = await getJson(
          `${host("archive-api")}/v1/archive?latitude=${la}&longitude=${lo}&start_date=${ymd(start)}&end_date=${ymd(end)}` +
            `&daily=precipitation_sum&timezone=Africa%2FLagos`,
        );
        return { key: k, months: monthlyTotals(j) };
      });
    },
  };
}

export type Weather = ReturnType<typeof createWeather>;

/** Turns Open-Meteo's forecast into what the phone keeps (daily humidity, soil moisture now). */
export function summariseForecast(key: string, j: any): FieldWeather {
  if (!j?.daily?.time || !j?.hourly?.time || !j?.current) throw new Error("Open-Meteo sent an unexpected forecast");
  const rh: Array<number | null> = j.hourly.relative_humidity_2m ?? [];
  const rhDaily = (j.daily.time as unknown[]).map((_, i) => {
    const a = rh.slice(i * 24, i * 24 + 24).filter((v): v is number => v != null);
    return a.length ? round1(a.reduce((x, y) => x + y, 0) / a.length) : null;
  });
  const hours: string[] = j.hourly.time;
  const nowIdx = hours.indexOf(String(j.current.time ?? "").slice(0, 13) + ":00");
  const soilSeries: Array<number | null> = j.hourly.soil_moisture_3_to_9cm ?? [];
  const soil = soilSeries[nowIdx >= 0 ? nowIdx : hours.length - 1] ?? null;
  return { key, current: j.current, daily: j.daily, rhDaily, soil };
}

/** Adds daily rain up into months. */
export function monthlyTotals(j: any): Array<[string, number]> {
  const time: string[] = j?.daily?.time ?? [];
  const rain: Array<number | null> = j?.daily?.precipitation_sum ?? [];
  const m = new Map<string, number>();
  time.forEach((t, i) => m.set(t.slice(0, 7), (m.get(t.slice(0, 7)) ?? 0) + (rain[i] ?? 0)));
  return [...m.keys()].sort().map((k) => [k, round1(m.get(k)!)]);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** A latitude/longitude pair from a request, or null if it isn't one. */
export function readPoint(lat: string | undefined, lon: string | undefined): { lat: number; lon: number } | null {
  const a = Number(lat), b = Number(lon);
  if (!lat || !lon || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lon: b };
}
