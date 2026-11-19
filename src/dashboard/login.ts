import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { clientIp, createGuard, samePassword } from "../core/security/guard.js";
import { esc, pageShell } from "./page.js";

// Signing in to /dashboard with DASHBOARD_PASSWORD on our own page, which then
// keeps a signed cookie for 30 days. The browser's own password box was shared
// with the quote setup pages on the same site, so signing in there could sign
// you out here. The cookie only goes to /dashboard pages, and changing the
// password signs everyone out.

const COOKIE = "yo_dashboard";
export const DASHBOARD_SESSION_DAYS = 30;

const keyFor = (password: string) => createHash("sha256").update(`yarnOga dashboard session:${password}`).digest("hex");
const secure = (c: Context) => new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";

/** Only pages on the dashboard itself, so the login can't send you elsewhere. */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/dashboard(\/[\w\-/]*)?(\?[^\s#]*)?(#[\w-]*)?$/.test(next) ? next : "/dashboard";
}

function basicPassword(header: string | undefined): string | null {
  const m = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1);
}

export function renderLogin(next: string, problem?: string): string {
  return pageShell({
    title: "Sign in · yarnOga analytics",
    crumb: "Owner dashboard",
    heading: "yarn<b>Oga</b> analytics",
    body: `<form class="entry login" method="post" action="/dashboard/login">
<h3>Sign in</h3>
${problem ? `<p class="problem" role="alert">${esc(problem)}</p>` : ""}
<input type="hidden" name="next" value="${esc(next)}">
<label>Dashboard password <input type="password" name="password" required autocomplete="current-password" autofocus></label>
<button type="submit">Sign in</button>
<p class="small">You stay signed in on this browser for ${DASHBOARD_SESSION_DAYS} days.</p>
</form>`,
    css: `.login { max-width:420px; margin:32px auto 0; grid-template-columns:1fr; }
.login .problem { grid-column:1 / -1; }`,
  });
}

/**
 * The sign-in page and the check in front of every other dashboard page. A
 * request with the password in a Basic header is still let in (scripts, tests),
 * and wrong passwords count against the same lock as the sign-in page.
 */
export function dashboardLogin(app: Hono, opts: { password: string; now?: () => Date; log?: Pick<Console, "warn"> }): MiddlewareHandler {
  const guard = createGuard("yarnOga dashboard", { log: opts.log });
  const key = keyFor(opts.password);
  const now = () => (opts.now ? opts.now() : new Date()).getTime();

  app.get("/login", (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(renderLogin(safeNext(c.req.query("next"))));
  });

  app.post("/login", async (c) => {
    c.header("Cache-Control", "no-store");
    const form = await c.req.parseBody();
    const next = safeNext(form.next);
    const ip = clientIp(c);
    if (guard.blocked(ip)) return c.html(renderLogin(next, "Too many wrong passwords. Wait 15 minutes and try again."), 429);
    if (typeof form.password !== "string" || !samePassword(form.password, opts.password)) {
      await guard.failed(ip);
      return c.html(renderLogin(next, "That password isn't right."), 401);
    }
    guard.succeeded(ip);
    const expires = now() + DASHBOARD_SESSION_DAYS * 86_400_000;
    await setSignedCookie(c, COOKIE, String(expires), key, {
      path: "/dashboard",
      httpOnly: true,
      secure: secure(c),
      sameSite: "Lax",
      maxAge: DASHBOARD_SESSION_DAYS * 86_400,
    });
    return c.redirect(next, 303);
  });

  app.get("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/dashboard" });
    return c.redirect("/dashboard/login", 303);
  });

  return async (c, next) => {
    const path = c.req.path.replace(/^\/dashboard/, "") || "/";
    if (path === "/login" || path === "/logout") return next();
    const expires = Number(await getSignedCookie(c, key, COOKIE));
    if (expires > now()) return next();
    const given = basicPassword(c.req.header("authorization"));
    if (given !== null) {
      const ip = clientIp(c);
      if (guard.blocked(ip)) return c.text("Too many wrong passwords. Wait 15 minutes and try again.", 429);
      if (samePassword(given, opts.password)) {
        guard.succeeded(ip);
        return next();
      }
      await guard.failed(ip);
    }
    c.header("Cache-Control", "no-store");
    if (c.req.method === "GET") {
      const url = new URL(c.req.url);
      return c.redirect(`/dashboard/login?next=${encodeURIComponent(`/dashboard${path === "/" ? "" : path}${url.search}`)}`, 303);
    }
    return c.text("Please sign in to the dashboard again.", 401);
  };
}
