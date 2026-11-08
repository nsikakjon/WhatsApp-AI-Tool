// Satellite crop health for Oko fields, from the European Sentinel-2
// satellites through the Copernicus Data Space (free with an account).
//
// Sentinel-2 photographs every field in Nigeria about every 5 days at 10 m
// detail. From the red and near-infrared light we work out NDVI, a
// "greenness" score from about 0 (bare soil) to about 0.9 (dense, healthy
// canopy). Clouds hide the ground, and southern Nigeria is cloudy for much of
// the rains, so cloudy pixels are thrown away and a date only counts when at
// least half the field could be seen.
//
// Two calls are used, both server-side (the keys never reach a phone):
//   - Statistical API: the field's average NDVI for every clear date in the
//     last 12 months (the trend chart);
//   - Process API: a coloured NDVI picture of the field from the latest clear
//     date (green = healthy, yellow/brown = thin or stressed).

export interface CopernicusConfig {
  clientId: string;
  clientSecret: string;
  /** Defaults to https://sh.dataspace.copernicus.eu */
  baseUrl?: string;
  tokenUrl?: string;
}

export interface NdviPoint {
  date: string; // YYYY-MM-DD
  mean: number;
  min: number;
  max: number;
  /** Share of the field that wasn't hidden by cloud (0–1). */
  clear: number;
}

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const BASE_URL = "https://sh.dataspace.copernicus.eu";
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
/** Dates where less of the field than this could be seen are dropped. */
export const MIN_CLEAR = 0.5;

// Sentinel-2 scene classification (SCL): 4 vegetation, 5 bare soil, 6 water
// count as "seen"; clouds, cloud shadows, cirrus, snow and bad pixels don't.
const STATS_SCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var seen = s.dataMask === 1 && (s.SCL === 4 || s.SCL === 5 || s.SCL === 6);
  var d = s.B08 + s.B04;
  var ndvi = d === 0 ? 0 : (s.B08 - s.B04) / d;
  return { ndvi: [ndvi], dataMask: [seen ? 1 : 0] };
}`;

// The "clear" output needs every pixel of the field counted, cloudy or not,
// so it gets its own request with a mask that only drops pixels outside the field.
const CLEAR_SCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["SCL", "dataMask"] }],
    output: [{ id: "clear", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }]
  };
}
function evaluatePixel(s) {
  var seen = s.SCL === 4 || s.SCL === 5 || s.SCL === 6;
  return { clear: [seen ? 1 : 0], dataMask: [s.dataMask] };
}`;

const IMAGE_SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }], output: { bands: 4 } };
}
var ramp = [[-0.1, 0x8c510a], [0.15, 0xd8b365], [0.3, 0xf6e8c3], [0.45, 0xc7e9b4], [0.6, 0x7fbc41], [0.75, 0x2c7a3c], [0.9, 0x0b4d22]];
var viz = new ColorRampVisualizer(ramp);
function evaluatePixel(s) {
  if (s.dataMask !== 1) return [0, 0, 0, 0];
  var cloud = !(s.SCL === 4 || s.SCL === 5 || s.SCL === 6);
  if (cloud) return [0.85, 0.85, 0.85, 1];
  var d = s.B08 + s.B04;
  var c = viz.process(d === 0 ? 0 : (s.B08 - s.B04) / d);
  return [c[0], c[1], c[2], 1];
}`;

export type Fetch = typeof fetch;

export function createSatellite(cfg: CopernicusConfig, fetchFn: Fetch = fetch) {
  const base = (cfg.baseUrl ?? BASE_URL).replace(/\/+$/, "");
  let token: { value: string; until: number } | null = null;
  let pending: Promise<string> | null = null;

  // One login shared by requests made at the same time (logins are rate-limited).
  function getToken(): Promise<string> {
    if (token && Date.now() < token.until) return Promise.resolve(token.value);
    pending ??= login().finally(() => (pending = null));
    return pending;
  }
  async function login(): Promise<string> {
    const res = await fetchFn(cfg.tokenUrl ?? TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    });
    if (!res.ok) throw new Error(`Copernicus login failed (${res.status}). Check COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET.`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error("Copernicus login returned no token");
    token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 600) - 60) * 1000 };
    return token.value;
  }

  async function post(path: string, body: unknown, accept: string): Promise<Response> {
    const send = async () =>
      fetchFn(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/json", accept },
        body: JSON.stringify(body),
      });
    let res = await send();
    if (res.status === 401) {
      token = null; // expired early: log in again once
      res = await send();
    }
    if (!res.ok) throw new Error(`Copernicus ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  const input = (ring: Array<[number, number]>, from: string, to: string) => ({
    bounds: { geometry: { type: "Polygon", coordinates: [closeRing(ring)] }, properties: { crs: CRS84 } },
    data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from, to }, maxCloudCoverage: 90 } }],
  });

  return {
    /** Average NDVI for each date the field could mostly be seen, oldest first. */
    async ndviSeries(ring: Array<[number, number]>, from: Date, to: Date): Promise<NdviPoint[]> {
      const range = { from: from.toISOString(), to: to.toISOString() };
      const agg = (evalscript: string) => ({ timeRange: range, aggregationInterval: { of: "P1D" }, evalscript, resx: 0.0001, resy: 0.0001 });
      const [ndviRes, clearRes] = await Promise.all([
        post("/api/v1/statistics", { input: input(ring, range.from, range.to), aggregation: agg(STATS_SCRIPT) }, "application/json"),
        post("/api/v1/statistics", { input: input(ring, range.from, range.to), aggregation: agg(CLEAR_SCRIPT) }, "application/json"),
      ]);
      return parseSeries((await ndviRes.json()) as StatsResponse, (await clearRes.json()) as StatsResponse);
    },

    /** A coloured NDVI picture of the field on one date (PNG, transparent outside the field). */
    async ndviImage(ring: Array<[number, number]>, date: string): Promise<Uint8Array> {
      const day = new Date(`${date}T00:00:00Z`);
      const next = new Date(day.getTime() + 86400_000);
      const { width, height } = imageSize(ring);
      const res = await post(
        "/api/v1/process",
        {
          input: { ...input(ring, day.toISOString(), next.toISOString()), data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from: day.toISOString(), to: next.toISOString() }, mosaickingOrder: "leastCC" } }] },
          output: { width, height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
          evalscript: IMAGE_SCRIPT,
        },
        "image/png",
      );
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

export type Satellite = ReturnType<typeof createSatellite>;

type StatsResponse = {
  data?: Array<{ interval: { from: string }; outputs?: Record<string, { bands?: { B0?: { stats?: { mean?: number | string; min?: number | string; max?: number | string; sampleCount?: number; noDataCount?: number } } } }>; error?: unknown }>;
};

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

export function parseSeries(ndvi: StatsResponse, clear: StatsResponse): NdviPoint[] {
  const clearBy = new Map<string, number>();
  for (const d of clear.data ?? []) {
    const m = num(d.outputs?.clear?.bands?.B0?.stats?.mean);
    if (Number.isFinite(m)) clearBy.set(d.interval.from.slice(0, 10), m);
  }
  const out: NdviPoint[] = [];
  for (const d of ndvi.data ?? []) {
    const s = d.outputs?.ndvi?.bands?.B0?.stats;
    const date = d.interval.from.slice(0, 10);
    const c = clearBy.get(date) ?? 0;
    const mean = num(s?.mean);
    if (!s || !Number.isFinite(mean) || c < MIN_CLEAR) continue;
    if ((s.sampleCount ?? 0) - (s.noDataCount ?? 0) < 4) continue;
    out.push({ date, mean: round(mean), min: round(num(s.min)), max: round(num(s.max)), clear: round(c) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);

function closeRing(ring: Array<[number, number]>): Array<[number, number]> {
  const a = ring[0]!, b = ring[ring.length - 1]!;
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

/** About 10 m per pixel (Sentinel-2's detail), drawn 128–512 pixels across. */
export function imageSize(ring: Array<[number, number]>): { width: number; height: number } {
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const w = Math.max(1, (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos((lat * Math.PI) / 180));
  const h = Math.max(1, (Math.max(...lats) - Math.min(...lats)) * 110540);
  let s = 0.1;
  const big = Math.max(w, h) * s;
  if (big < 128) s *= 128 / big;
  if (big > 512) s *= 512 / big;
  return { width: Math.max(8, Math.round(w * s)), height: Math.max(8, Math.round(h * s)) };
}

/** Area of a lon/lat ring in hectares (good enough for a size check). */
export function ringHectares(ring: Array<[number, number]>): number {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const k = 111320 * Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    a += p[0] * k * (q[1] * 110540) - q[0] * k * (p[1] * 110540);
  }
  return Math.abs(a / 2) / 10000;
}
