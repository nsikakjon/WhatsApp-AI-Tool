import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { renderDashboard } from "./page.js";
import type { SocialsSource } from "./socials.js";
import type { StatsSource } from "./stats.js";
import { exchangeTikTokCode, tiktokAuthorizeUrl, type TikTokApp } from "./tiktok.js";

// The owner's analytics page at /dashboard. The browser asks for a password
// (DASHBOARD_PASSWORD); any username works. It only reads from the database.

export interface DashboardDeps {
  password: string;
  stats: StatsSource;
  socials?: SocialsSource;
  /** The TikTok developer app, for the one-time connect button. */
  tiktokApp?: TikTokApp;
  fetch?: typeof fetch;
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
      const now = deps.now?.() ?? new Date();
      const [stats, socials] = await Promise.all([deps.stats.load(now), deps.socials?.load(now) ?? []]);
      return c.html(renderDashboard(stats, socials));
    } catch (err) {
      log.error("Dashboard failed to load:", err);
      return c.text("The dashboard couldn't read the database just now. Please refresh in a minute.", 500);
    }
  });

  // Connecting TikTok: send the owner to TikTok to allow access, then show the
  // key TikTok hands back so they can paste it into Railway.
  const pendingStates = new Set<string>();
  const callbackUrl = (host: string | undefined) => `https://${host}/dashboard/tiktok/callback`;

  app.get("/tiktok/connect", (c) => {
    if (!deps.tiktokApp) {
      return c.text("Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on Railway first (see docs/DASHBOARD.md).", 400);
    }
    const state = randomBytes(16).toString("hex");
    pendingStates.add(state);
    return c.redirect(tiktokAuthorizeUrl(deps.tiktokApp, callbackUrl(c.req.header("host")), state));
  });

  app.get("/tiktok/callback", async (c) => {
    c.header("Cache-Control", "no-store");
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code");
    if (!deps.tiktokApp || !pendingStates.delete(state) || !code) {
      return c.text("This TikTok sign-in link has expired. Open /dashboard/tiktok/connect and try again.", 400);
    }
    try {
      const tokens = await exchangeTikTokCode(
        deps.fetch ?? fetch,
        deps.tiktokApp,
        code,
        callbackUrl(c.req.header("host")),
      );
      return c.html(tiktokConnectedPage(tokens.refreshToken));
    } catch (err) {
      log.error("TikTok connect failed:", err);
      return c.text(`TikTok sign-in didn't finish: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
  });

  return app;
}

function tiktokConnectedPage(refreshToken: string): string {
  const safe = refreshToken.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>TikTok connected</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0c0d0d;color:#f3f4ef}main{max-width:640px;margin:0 auto;padding:32px 16px}
code{display:block;word-break:break-all;background:#191a1a;border:1px solid #2e302f;border-radius:8px;padding:12px;margin:12px 0;user-select:all}a{color:#c6ff1f}</style></head>
<body><main><h1>TikTok connected</h1>
<p>One last step. Copy this key, then in Railway open <b>Variables</b> and add it as <b>TIKTOK_REFRESH_TOKEN</b>:</p>
<code>${safe}</code>
<p>Keep it private, like a password. After Railway redeploys, your TikTok numbers appear on the <a href="/dashboard">dashboard</a>. The key lasts about a year; when TikTok stops loading, open this connect page again.</p>
</main></body></html>`;
}

/** Compares in constant time, so response timing can't reveal the password letter by letter. */
function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
