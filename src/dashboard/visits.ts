import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { lagosDays } from "./stats.js";

// The visitor counter for yarnoga.com. A tiny script on every page of the site
// tells this endpoint "someone opened /flyers.html", and the dashboard shows
// the totals. No cookies, nothing from other companies, and no IP addresses
// are kept: each visitor gets a code made from their IP and browser that
// changes every day, enough to count people per day and nothing more.

/** Only page views sent from the real site are counted. */
const SITE_ORIGINS = ["https://yarnoga.com", "https://www.yarnoga.com"];
const SITE_HOSTS = new Set(SITE_ORIGINS.map((o) => new URL(o).hostname));

// Search engines, link previews (WhatsApp, Facebook) and scripts, not people.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|node-fetch|go-http|java\//i;

export interface SiteVisit {
  day: string;
  path: string;
  referrerHost: string | null;
  visitor: string;
}

export interface VisitStore {
  record(visit: SiteVisit): Promise<void>;
}

export interface VisitCounterDeps {
  store: VisitStore;
  /** A server secret mixed into the daily visitor code, so it can't be worked backwards. */
  secret: string;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

export function createVisitCounter(deps: VisitCounterDeps) {
  const app = new Hono();
  const log = deps.log ?? console;

  const cors = (origin: string | undefined) =>
    origin && SITE_ORIGINS.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", Vary: "Origin" }
      : undefined;

  app.options("/", (c) => {
    const headers = cors(c.req.header("origin"));
    return c.body(null, headers ? 204 : 403, headers);
  });

  app.post("/", async (c) => {
    const origin = c.req.header("origin");
    const headers = cors(origin);
    // Always answer "fine" quickly; the visitor's page never waits on this.
    const done = () => c.body(null, 204, headers ?? {});
    if (!headers) return done();

    const userAgent = c.req.header("user-agent") ?? "";
    if (!userAgent || BOT_PATTERN.test(userAgent)) return done();

    const raw = await c.req.text();
    if (raw.length > 2000) return done();
    let body: { p?: unknown; r?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return done();
    }
    const path = cleanPath(body.p);
    if (!path) return done();

    const now = deps.now?.() ?? new Date();
    const day = lagosDays(now, 1)[0].date;
    const ip = (c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "").split(",")[0].trim();
    try {
      await deps.store.record({
        day,
        path,
        referrerHost: referrerHost(body.r),
        visitor: visitorCode(deps.secret, day, ip, userAgent),
      });
    } catch (err) {
      log.error("Couldn't record a website visit:", err);
    }
    return done();
  });

  return app;
}

/** "/flyers.html?ref=x" -> "/flyers.html"; "/index.html" -> "/". Anything odd -> null. */
export function cleanPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  let path: string;
  try {
    path = new URL(value, "https://yarnoga.com").pathname;
  } catch {
    return null;
  }
  path = path.replace(/\/index\.html$/, "/");
  return path.slice(0, 200);
}

/** "https://www.google.com/search?q=..." -> "www.google.com". Clicks within yarnoga.com -> null. */
export function referrerHost(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host && !SITE_HOSTS.has(host) ? host.slice(0, 100) : null;
  } catch {
    return null;
  }
}

export function visitorCode(secret: string, day: string, ip: string, userAgent: string): string {
  return createHmac("sha256", secret).update(`${day}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
}

export function createSupabaseVisitStore(db: SupabaseClient): VisitStore {
  return {
    async record(v) {
      const { error } = await db
        .from("site_visits")
        .insert({ day: v.day, path: v.path, referrer_host: v.referrerHost, visitor: v.visitor });
      if (error) throw new Error(error.message);
    },
  };
}

// --- Numbers for the dashboard ---

export interface WebsiteStats {
  viewsToday: number;
  visitorsToday: number;
  views7: number;
  views30: number;
  /** Per Lagos day, oldest first, last 30 days. */
  daily: { date: string; views: number; visitors: number }[];
  /** Most viewed pages, last 30 days. */
  topPages: { path: string; views: number }[];
  /** Sites visitors came from, last 30 days; "" means typed in, a bookmark or an app. */
  topSources: { source: string; views: number }[];
}

export interface WebsiteStatsSource {
  load(now: Date): Promise<WebsiteStats>;
}

export function summariseVisitDays(
  rows: { day: string; views: number; visitors: number }[],
  now: Date,
): Pick<WebsiteStats, "viewsToday" | "visitorsToday" | "views7" | "views30" | "daily"> {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const daily = lagosDays(now, 30).map((d) => ({
    date: d.date,
    views: byDay.get(d.date)?.views ?? 0,
    visitors: byDay.get(d.date)?.visitors ?? 0,
  }));
  const sum = (days: typeof daily) => days.reduce((n, d) => n + d.views, 0);
  const today = daily[daily.length - 1];
  return { viewsToday: today.views, visitorsToday: today.visitors, views7: sum(daily.slice(-7)), views30: sum(daily), daily };
}

export function createSupabaseWebsiteStats(db: SupabaseClient): WebsiteStatsSource {
  async function read<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
    const { data, error } = await query;
    if (error) throw new Error(`Reading website visits failed: ${error.message}`);
    return (data ?? []) as T[];
  }

  return {
    async load(now) {
      const first = lagosDays(now, 30)[0].date;
      const [days, pages, sources] = await Promise.all([
        read<{ day: string; views: number; visitors: number }>(
          db.from("site_visit_days").select("day, views, visitors").gte("day", first),
        ),
        read<{ path: string; views: number }>(
          db.from("site_visit_pages_30d").select("path, views").order("views", { ascending: false }).limit(8),
        ),
        read<{ source: string; views: number }>(
          db.from("site_visit_sources_30d").select("source, views").order("views", { ascending: false }).limit(8),
        ),
      ]);
      return { ...summariseVisitDays(days, now), topPages: pages, topSources: sources };
    },
  };
}
