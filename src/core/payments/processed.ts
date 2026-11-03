import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";

// The "₦X processed through yarnOga" line on yarnoga.com. It adds up every
// naira payment that really arrived through our pay links (plans, top-ups and
// shops' own customers), and stays silent until the total reaches the amount
// jay sets in PROCESSED_COUNTER_MIN_NAIRA. The site gets a rounded-down
// figure, never the exact one.

const SITE_ORIGINS = ["https://yarnoga.com", "https://www.yarnoga.com"];
const HOUR = 60 * 60 * 1000;

export interface ProcessedCounterDeps {
  /** Kobo paid in naira so far. */
  totalKobo: () => Promise<number>;
  /** Below this the site shows nothing. */
  minKobo: number;
  now?: () => number;
  log?: Pick<Console, "error">;
}

/** 2,437,512 -> 2,400,000; 851,000 -> 850,000. Rounded down to two leading digits. */
export function roundDownNaira(kobo: number): number {
  const naira = Math.floor(kobo / 100);
  if (naira < 100) return naira;
  const step = 10 ** (String(naira).length - 2);
  return Math.floor(naira / step) * step;
}

export function createProcessedCounter(deps: ProcessedCounterDeps) {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  let cached: { kobo: number; at: number } | undefined;

  app.get("/", async (c) => {
    const origin = c.req.header("origin");
    if (origin && SITE_ORIGINS.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    c.header("Cache-Control", "public, max-age=3600");

    if (!cached || now() - cached.at > HOUR) {
      try {
        cached = { kobo: await deps.totalKobo(), at: now() };
      } catch (err) {
        log.error("Could not add up payments for the website counter:", err);
      }
    }
    if (!cached || cached.kobo < deps.minKobo) return c.json({});
    return c.json({ naira: roundDownNaira(cached.kobo) });
  });

  return app;
}

/** Adds up paid naira payments, a thousand rows at a time. */
export function createSupabaseProcessedTotal(db: SupabaseClient): () => Promise<number> {
  return async () => {
    let total = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("payments")
        .select("amount_kobo")
        .eq("status", "paid")
        .eq("currency", "NGN")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      for (const row of data) total += Number(row.amount_kobo);
      if (data.length < 1000) return total;
    }
  };
}
