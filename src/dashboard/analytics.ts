import { createSign } from "node:crypto";
import { lagosDays } from "./stats.js";

// Google Analytics numbers for yarnoga.com, read from the GA4 Data API with a
// Google Cloud service account that has Viewer access to the GA property.
// Like the socials, nothing set shows "Not connected" and a failed call shows
// Google's reason, so the page never shows a guessed number.

export interface AnalyticsRow {
  label: string;
  count: number;
}

export interface AnalyticsReport {
  users30: number;
  newUsers30: number;
  sessions30: number;
  views30: number;
  users7: number;
  daily: { date: string; users: number }[];
  topPages: AnalyticsRow[];
  sources: AnalyticsRow[];
}

export type AnalyticsResult =
  | { status: "live"; report: AnalyticsReport }
  | { status: "not_connected" }
  | { status: "error"; problem: string };

export interface AnalyticsSource {
  load(now: Date): Promise<AnalyticsResult>;
}

export interface AnalyticsOptions {
  /** GA_PROPERTY_ID: the property's number, from Admin > Property details. */
  propertyId?: string;
  /** GA_SERVICE_ACCOUNT_KEY: the whole JSON key file downloaded from Google Cloud. */
  serviceAccountKey?: string;
  fetch?: typeof fetch;
  cacheMs?: number;
}

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64url(text: string | Buffer): string {
  return Buffer.from(text).toString("base64url");
}

/** GA dates come back as 20261114. */
function isoDate(gaDate: string): string {
  return `${gaDate.slice(0, 4)}-${gaDate.slice(4, 6)}-${gaDate.slice(6, 8)}`;
}

export function createAnalytics(opts: AnalyticsOptions): AnalyticsSource {
  const fetchFn = opts.fetch ?? fetch;
  const cacheMs = opts.cacheMs ?? 10 * 60 * 1000;
  let cached: { at: number; result: AnalyticsResult } | undefined;
  let token: { value: string; expires: number } | undefined;

  async function accessToken(key: { client_email: string; private_key: string }, now: number): Promise<string> {
    if (token && token.expires - 60_000 > now) return token.value;
    const iat = Math.floor(now / 1000);
    const claims = { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${base64url(signature)}`,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? `status ${res.status}`}`);
    }
    token = { value: body.access_token, expires: now + Number(body.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function fetchReport(propertyId: string, key: { client_email: string; private_key: string }, now: Date): Promise<AnalyticsReport> {
    const last30 = [{ startDate: "29daysAgo", endDate: "today" }];
    const res = await fetchFn(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(key, now.getTime())}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          { dateRanges: last30, metrics: [{ name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" }, { name: "screenPageViews" }] },
          { dateRanges: [{ startDate: "6daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] },
          { dateRanges: last30, dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }] },
          {
            dateRanges: last30,
            dimensions: [{ name: "pagePath" }],
            metrics: [{ name: "screenPageViews" }],
            orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
            limit: 10,
          },
          {
            dateRanges: last30,
            dimensions: [{ name: "sessionDefaultChannelGroup" }, { name: "sessionSource" }],
            metrics: [{ name: "sessions" }],
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
            limit: 10,
          },
        ],
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? `request failed with status ${res.status}`);

    const [totals, week, days, pages, sources] = (body.reports ?? []).map((r: any) => r?.rows ?? []);
    const metric = (row: any, i = 0) => Number(row?.metricValues?.[i]?.value ?? 0);
    const dims = (row: any): string[] => (row?.dimensionValues ?? []).map((d: any) => String(d?.value ?? ""));
    const byDay = new Map<string, number>((days ?? []).map((r: any) => [isoDate(dims(r)[0]!), metric(r)]));
    return {
      users30: metric(totals?.[0], 0),
      newUsers30: metric(totals?.[0], 1),
      sessions30: metric(totals?.[0], 2),
      views30: metric(totals?.[0], 3),
      users7: metric(week?.[0]),
      daily: lagosDays(now, 30).map(({ date }) => ({ date, users: byDay.get(date) ?? 0 })),
      topPages: (pages ?? []).map((r: any) => ({ label: dims(r)[0]!, count: metric(r) })),
      sources: (sources ?? []).map((r: any) => {
        const [channel, source] = dims(r);
        return { label: source && source !== "(direct)" && source !== "(not set)" ? `${channel}: ${source}` : channel!, count: metric(r) };
      }),
    };
  }

  async function loadFresh(now: Date): Promise<AnalyticsResult> {
    const propertyId = opts.propertyId?.replace(/\D/g, "");
    if (!propertyId || !opts.serviceAccountKey) return { status: "not_connected" };
    let key: { client_email: string; private_key: string };
    try {
      key = JSON.parse(opts.serviceAccountKey);
      if (!key.client_email || !key.private_key) throw new Error();
    } catch {
      return { status: "error", problem: "GA_SERVICE_ACCOUNT_KEY isn't the full JSON key file. Paste the whole file, from { to }." };
    }
    try {
      return { status: "live", report: await fetchReport(propertyId, key, now) };
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const hint = /permission/i.test(text)
        ? ` In Google Analytics > Admin > Property access management, add ${key.client_email} as a Viewer, and check GA_PROPERTY_ID.`
        : "";
      return { status: "error", problem: `Google said: ${text}${hint}` };
    }
  }

  return {
    async load(now) {
      if (cached && now.getTime() - cached.at < cacheMs) return cached.result;
      const result = await loadFresh(now);
      cached = { at: now.getTime(), result };
      return result;
    },
  };
}
