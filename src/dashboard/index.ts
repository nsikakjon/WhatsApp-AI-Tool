import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { renderDashboard } from "./page.js";
import type { StatsSource } from "./stats.js";

// The owner's analytics page at /dashboard. The browser asks for a password
// (DASHBOARD_PASSWORD); any username works. It only reads from the database.

export interface DashboardDeps {
  password: string;
  stats: StatsSource;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

export function createDashboard(deps: DashboardDeps) {
  const app = new Hono();
  const log = deps.log ?? console;

  app.use(
    "*",
    basicAuth({
      verifyUser: (_username, password) => samePassword(password, deps.password),
      realm: "yarnOga dashboard",
    }),
  );

  app.get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const stats = await deps.stats.load(deps.now?.() ?? new Date());
      return c.html(renderDashboard(stats));
    } catch (err) {
      log.error("Dashboard failed to load:", err);
      return c.text("The dashboard couldn't read the database just now. Please refresh in a minute.", 500);
    }
  });

  return app;
}

/** Compares in constant time, so response timing can't reveal the password letter by letter. */
function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
