import { describe, expect, it, vi } from "vitest";
import { createSatellite, imageSize, parseSeries, ringHectares } from "./satellite.js";
import { boundaryRing, createFarm } from "./index.js";
import { memoryFarmStore } from "./store.js";

// About 100 m × 100 m near Idanre (lon, lat).
const RING: Array<[number, number]> = [[5.1180, 7.1120], [5.1189, 7.1120], [5.1189, 7.1129], [5.1180, 7.1129]];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const stat = (date: string, out: string, mean: number, samples = 100) => ({
  interval: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
  outputs: { [out]: { bands: { B0: { stats: { mean, min: mean - 0.1, max: mean + 0.1, sampleCount: samples, noDataCount: 0 } } } } },
});

function fakeCopernicus() {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 600 }), { status: 200 });
    const body = JSON.parse(String(init?.body));
    calls.push({ url: u, body });
    if (u.endsWith("/api/v1/statistics")) {
      const isClear = String(body.aggregation.evalscript).includes('id: "clear"');
      const data = isClear
        ? [stat("2026-09-02", "clear", 0.2), stat("2026-10-14", "clear", 0.9), stat("2026-11-03", "clear", 0.75)]
        : [stat("2026-09-02", "ndvi", 0.31), stat("2026-10-14", "ndvi", 0.72), stat("2026-11-03", "ndvi", 0.68)];
      return new Response(JSON.stringify({ data, status: "OK" }), { status: 200 });
    }
    if (u.endsWith("/api/v1/process")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    return new Response("nope", { status: 404 });
  });
  return { fetchFn, calls };
}

describe("satellite crop health", () => {
  it("asks for the field's NDVI and keeps only dates where the field could mostly be seen", async () => {
    const { fetchFn, calls } = fakeCopernicus();
    const sat = createSatellite({ clientId: "id", clientSecret: "secret" }, fetchFn as unknown as typeof fetch);
    const series = await sat.ndviSeries(RING, new Date("2025-11-08"), new Date("2026-11-08"));
    expect(series.map((p) => [p.date, p.mean, p.clear])).toEqual([["2026-10-14", 0.72, 0.9], ["2026-11-03", 0.68, 0.75]]);
    const req = calls[0]!.body;
    expect(calls[0]!.url).toBe("https://sh.dataspace.copernicus.eu/api/v1/statistics");
    expect(req.input.bounds.geometry.coordinates[0]).toHaveLength(5); // closed ring
    expect(req.input.data[0].type).toBe("sentinel-2-l2a");
    expect(req.aggregation.aggregationInterval.of).toBe("P1D");
    // logged in once for both requests
    expect(fetchFn.mock.calls.filter((c) => String(c[0]).includes("/token"))).toHaveLength(1);
  });

  it("drops dates with too few pixels", () => {
    const ndvi = { data: [stat("2026-10-01", "ndvi", 0.7, 2)] };
    const clear = { data: [stat("2026-10-01", "clear", 1)] };
    expect(parseSeries(ndvi, clear)).toEqual([]);
  });

  it("sizes the picture at about Sentinel-2's 10 m detail", () => {
    const { width, height } = imageSize(RING);
    expect(width).toBeGreaterThanOrEqual(120);
    expect(Math.abs(width - height)).toBeLessThan(15);
    expect(ringHectares(RING)).toBeCloseTo(1, 0);
  });

  it("reads a field's boundary from its beacons", () => {
    expect(boundaryRing({ beacons: [{ lat: 7.1, lon: 5.1 }, { lat: 7.2, lon: 5.1 }] })).toBeNull();
    expect(boundaryRing({ beacons: [{ lat: 7.1, lon: 5.1 }, { lat: 7.2, lon: 5.1 }, { lat: 7.2, lon: 5.2 }] })).toEqual([[5.1, 7.1], [5.1, 7.2], [5.2, 7.2]]);
  });
});

describe("satellite endpoint", () => {
  async function setup(withSatellite = true) {
    const { fetchFn, calls } = fakeCopernicus();
    const store = memoryFarmStore();
    let t = new Date("2026-11-08T10:00:00Z");
    const app = createFarm({
      password: "farm-password-123",
      store,
      log: { info() {}, error() {} },
      now: () => t,
      satellite: withSatellite ? createSatellite({ clientId: "id", clientSecret: "s" }, fetchFn as unknown as typeof fetch) : undefined,
    });
    let cookie = "";
    const req = async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      if (init.method && init.method !== "GET") headers.set("x-oko", "1");
      const res = await app.request(path, { ...init, headers });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return res;
    };
    await req("/admin", { headers: { authorization: `Basic ${btoa("jay:farm-password-123")}` } });
    const beacons = RING.map(([lon, lat], i) => ({ id: `b${i}`, lat, lon }));
    await req("/api/fields/fld000010", { method: "PUT", body: JSON.stringify({ data: { f: { name: "Cocoa" }, beacons } }), headers: { "content-type": "application/json" } });
    await req("/api/fields/fld000011", { method: "PUT", body: JSON.stringify({ data: { f: { name: "No boundary" } } }), headers: { "content-type": "application/json" } });
    return { req, calls, advance: (h: number) => (t = new Date(t.getTime() + h * 3600_000)) };
  }

  it("gives the trend and picture, and only asks the satellite service again after 12 hours", async () => {
    const { req, calls, advance } = await setup();
    const first = (await (await req("/api/fields/fld000010/satellite")).json()) as any;
    expect(first.latest).toMatchObject({ date: "2026-11-03", mean: 0.68 });
    expect(first.series).toHaveLength(2);
    expect(first.imageUrl).toBe("api/fields/fld000010/satellite.png?d=2026-11-03");
    const img = await req("/api/fields/fld000010/satellite.png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
    const n = calls.length;
    await req("/api/fields/fld000010/satellite");
    expect(calls.length).toBe(n);
    advance(13);
    await req("/api/fields/fld000010/satellite");
    // two statistics calls again, but the picture for the same date isn't fetched twice
    expect(calls.slice(n).map((c) => c.url.split("/").pop())).toEqual(["statistics", "statistics"]);
  });

  it("asks for a boundary first, and says when satellite isn't set up", async () => {
    const { req } = await setup();
    expect(await (await req("/api/fields/fld000011/satellite")).json()).toEqual({ configured: true, needsBoundary: true });
    const off = await setup(false);
    expect(await (await off.req("/api/fields/fld000010/satellite")).json()).toEqual({ configured: false });
  });
});
