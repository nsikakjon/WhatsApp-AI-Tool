// Field weather from Open-Meteo (free, no key), fetched the same way the
// phone does in farm-app/js/app.js (refreshWx), so the alert rules in
// crops.js see the same numbers on the server as on the phone.
//
// Open-Meteo's free service is for non-commercial use: switch to their paid
// plan (or another provider) before Oko goes public. See docs/FARM.md.

export interface FieldWeather {
  current: Record<string, unknown>;
  daily: Record<string, unknown[]> & { time: string[] };
  rhDaily: Array<number | null>;
  soil: number | null;
}

export type FetchWeather = (lat: number, lon: number) => Promise<FieldWeather>;

export function createWeather(doFetch: typeof fetch = fetch): FetchWeather {
  return async (lat, lon) => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
      `&hourly=relative_humidity_2m,soil_moisture_3_to_9cm` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration` +
      `&past_days=31&forecast_days=8&timezone=Africa%2FLagos`;
    const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const j = (await res.json()) as {
      current: Record<string, unknown> & { time?: string };
      daily: FieldWeather["daily"];
      hourly: { time: string[]; relative_humidity_2m: Array<number | null>; soil_moisture_3_to_9cm: Array<number | null> };
    };
    if (!j?.daily?.time || !j.hourly?.relative_humidity_2m) throw new Error("Open-Meteo sent an answer without daily weather");
    const rhDaily = j.daily.time.map((_, i) => {
      const a = j.hourly.relative_humidity_2m.slice(i * 24, i * 24 + 24).filter((v): v is number => v != null);
      return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    });
    const nowIdx = j.current?.time ? j.hourly.time.indexOf(`${j.current.time.slice(0, 13)}:00`) : -1;
    const soil = j.hourly.soil_moisture_3_to_9cm?.[nowIdx >= 0 ? nowIdx : j.hourly.time.length - 1] ?? null;
    return { current: j.current, daily: j.daily, rhDaily, soil };
  };
}

/** Where to get a field's weather: its boundary's middle, its pin, or its state's capital (as the phone does). */
export function fieldLocation(data: Record<string, unknown>, states: Record<string, [number, number]>): { lat: number; lon: number } | null {
  const beacons = (Array.isArray(data.beacons) ? data.beacons : []) as Array<{ lat?: unknown; lon?: unknown }>;
  const pts = beacons.map((b) => ({ lat: Number(b.lat), lon: Number(b.lon) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length) return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
  const loc = data.loc as { lat?: unknown; lon?: unknown } | undefined;
  if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon))) return { lat: Number(loc.lat), lon: Number(loc.lon) };
  const state = (data.f as { state?: unknown } | undefined)?.state;
  const st = typeof state === "string" ? states[state] : undefined;
  return st ? { lat: st[0], lon: st[1] } : null;
}
