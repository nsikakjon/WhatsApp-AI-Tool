import { describe, expect, it } from "vitest";
import { createFarm } from "./index.js";
import { memoryFarmStore } from "./store.js";
import { createWeather, monthlyTotals, readPoint, summariseForecast } from "./weather.js";

const T0 = Date.parse("2026-11-08T10:00:00Z");

/** Two days of an Open-Meteo forecast, enough to check the summary. */
function forecastJson() {
  const hours: string[] = [];
  for (const d of ["2026-11-07", "2026-11-08"]) for (let h = 0; h < 24; h++) hours.push(`${d}T${String(h).padStart(2, "0")}:00`);
  return {
    current: { time: "2026-11-08T10:45", temperature_2m: 29.1, relative_humidity_2m: 80, precipitation: 0, weather_code: 2, wind_speed_10m: 6 },
    hourly: {
      time: hours,
      relative_humidity_2m: hours.map((_, i) => (i < 24 ? 70 : 90)),
      soil_moisture_3_to_9cm: hours.map((_, i) => i / 100),
    },
    daily: { time: ["2026-11-07", "2026-11-08"], precipitation_sum: [3.2, 0] },
  };
}
const archiveJson = { daily: { time: ["2026-10-30", "2026-10-31", "2026-11-01"], precipitation_sum: [10, 5.55, null] } };

function fakeOpenMeteo(fail = false) {
  const calls: string[] = [];
  const fetchFn = async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (fail) return new Response("down", { status: 500 });
    return new Response(JSON.stringify(u.includes("/archive") ? archiveJson : forecastJson()), { headers: { "content-type": "application/json" } });
  };
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

describe("weather from Open-Meteo", () => {
  it("works out daily humidity and soil moisture now", () => {
    const w = summariseForecast("7.10,5.20", forecastJson());
    expect(w.rhDaily).toEqual([70, 90]);
    expect(w.soil).toBe(0.34); // 10:00 on the 8th is hour 34
    expect(w.daily.precipitation_sum).toEqual([3.2, 0]);
    expect(() => summariseForecast("k", { daily: {} })).toThrow();
  });

  it("adds daily rain up into months", () => {
    expect(monthlyTotals(archiveJson)).toEqual([["2026-10", 15.6], ["2026-11", 0]]);
  });

  it("uses the free service without a key, and the paid one with it (the key stays on the server)", async () => {
    const free = fakeOpenMeteo();
    const w = createWeather({}, free.fetchFn, () => T0);
    expect(w.provider).toBe("open-meteo-free");
    await w.forecast(7.1234, 5.2001);
    expect(free.calls[0]).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=7\.12&longitude=5\.20&/);
    expect(free.calls[0]).not.toContain("apikey");

    const paid = fakeOpenMeteo();
    const p = createWeather({ apiKey: "secret-key" }, paid.fetchFn, () => T0);
    expect(p.provider).toBe("open-meteo-paid");
    const out = await p.forecast(7.1234, 5.2001);
    await p.monthly(7.1234, 5.2001);
    expect(paid.calls[0]).toMatch(/^https:\/\/customer-api\.open-meteo\.com\/v1\/forecast\?.*&apikey=secret-key$/);
    expect(paid.calls[1]).toMatch(/^https:\/\/customer-archive-api\.open-meteo\.com\/v1\/archive\?.*start_date=2025-12-01&end_date=2026-11-02.*&apikey=secret-key$/);
    expect(JSON.stringify(out)).not.toContain("secret-key");
  });

  it("shares one answer between nearby fields for an hour, and asks once for requests made together", async () => {
    const { calls, fetchFn } = fakeOpenMeteo();
    let t = T0;
    const w = createWeather({}, fetchFn, () => t);
    await Promise.all([w.forecast(7.101, 5.201), w.forecast(7.104, 5.199)]);
    expect(calls).toHaveLength(1);
    t += 59 * 60_000;
    await w.forecast(7.1, 5.2);
    expect(calls).toHaveLength(1);
    await w.forecast(7.3, 5.2); // a different square
    expect(calls).toHaveLength(2);
    t += 2 * 60_000;
    await w.forecast(7.1, 5.2);
    expect(calls).toHaveLength(3);
  });

  it("keeps giving the last answer when Open-Meteo is down", async () => {
    let fail = false;
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return fail ? new Response("down", { status: 503 }) : new Response(JSON.stringify(forecastJson()));
    }) as unknown as typeof fetch;
    let t = T0;
    const w = createWeather({}, fetchFn, () => t);
    const first = await w.forecast(7.1, 5.2);
    fail = true;
    t += 2 * 3600_000;
    expect(await w.forecast(7.1, 5.2)).toEqual(first);
    expect(calls).toHaveLength(2);
    await expect(w.forecast(8, 6)).rejects.toThrow(/503/);
  });

  it("reads a location from a request", () => {
    expect(readPoint("7.1", "5.2")).toEqual({ lat: 7.1, lon: 5.2 });
    expect(readPoint("91", "5")).toBeNull();
    expect(readPoint("abc", "5")).toBeNull();
    expect(readPoint(undefined, "5")).toBeNull();
    expect(readPoint("", "")).toBeNull();
  });
});

describe("weather endpoint", () => {
  async function setup(opts: { weather?: boolean; fail?: boolean } = {}) {
    const om = fakeOpenMeteo(opts.fail);
    const app = createFarm({
      password: "farm-password-123",
      store: memoryFarmStore(),
      log: { info() {}, error() {} },
      weather: opts.weather === false ? undefined : createWeather({ apiKey: "k" }, om.fetchFn, () => T0),
    });
    let cookie = "";
    const req = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      const res = await app.request(path, { ...init, headers });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return res;
    };
    return { req, calls: om.calls, login: () => req("/admin", { headers: { authorization: `Basic ${btoa("jay:farm-password-123")}` } }) };
  }

  it("needs a login, so the paid allowance can't be used by strangers", async () => {
    const { req, calls } = await setup();
    expect((await req("/api/weather?lat=7.1&lon=5.2")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("gives logged-in phones the forecast and monthly rain", async () => {
    const { req, login } = await setup();
    await login();
    const res = await req("/api/weather?lat=7.1&lon=5.2");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const w = (await res.json()) as any;
    expect(w).toMatchObject({ key: "7.10,5.20", rhDaily: [70, 90], soil: 0.34 });
    expect(w.current.temperature_2m).toBe(29.1);
    const m = (await (await req("/api/weather/monthly?lat=7.1&lon=5.2")).json()) as any;
    expect(m.months).toEqual([["2026-10", 15.6], ["2026-11", 0]]);
    expect((await req("/api/weather?lat=x&lon=5.2")).status).toBe(400);
  });

  it("says when weather isn't set up on the server, and when Open-Meteo is down", async () => {
    const off = await setup({ weather: false });
    await off.login();
    const r = await off.req("/api/weather?lat=7.1&lon=5.2");
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ configured: false });
    const down = await setup({ fail: true });
    await down.login();
    expect((await down.req("/api/weather?lat=7.1&lon=5.2")).status).toBe(502);
  });
});
