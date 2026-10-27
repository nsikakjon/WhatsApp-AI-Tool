import { registerCustomers } from "./sections/customers.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { clientIp, createGuard } from "../core/security/guard.js";
import { checkPassword, cookieSecret, hashToken, normaliseWaId, readSession, SESSION_DAYS, sameText, sessionValue } from "./auth.js";
import { ordersCsv } from "./exports.js";
import { bare, esc, page } from "./layout.js";
import { registerDashboard } from "./sections/dashboard.js";
import { registerInbox } from "./sections/inbox.js";
import { registerOrders } from "./sections/orders.js";
import { registerPrices } from "./sections/prices.js";
import { registerDelivery } from "./sections/delivery.js";
import { registerSettings } from "./sections/settings.js";
import { registerTools } from "./sections/tools.js";
import { registerVerify } from "./sections/verify.js";
import type { AppUser } from "./store.js";
import type { AppContext, Env, OwnerAppDeps } from "./types.js";

export type { OwnerAppDeps, AppBusiness, BankDirectory } from "./types.js";
export { field } from "./layout.js";

// The owners' and staff web app at /app (app.yarnoga.com). Each person logs
// in (see auth.ts) and sees only their own business. Owners see everything;
// staff see everything except Settings and Export (money, bank accounts,
// alert numbers and the team).

const COOKIE = "yarnoga_app";

/** Short notes shown at the top of a page after a form, by code (never text from the address bar). */
export const FLASH: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Saved." },
  removed: { ok: true, text: "Removed." },
  added: { ok: true, text: "Added." },
  sent: { ok: true, text: "Sent." },
  paid: { ok: true, text: "Marked paid. The customer has been sent their receipt." },
  moved: { ok: true, text: "Order moved." },
  password: { ok: true, text: "Password saved. Your other logins have been logged out." },
  logout_all: { ok: true, text: "Every other login has been logged out." },
  new_link: { ok: true, text: "New link made. The old one no longer works." },
  bad: { ok: false, text: "Something in the form isn't right. Please check and try again." },
  not_paid: { ok: false, text: "That order couldn't be marked paid (it may be paid already or cancelled)." },
  window: { ok: false, text: "WhatsApp won't deliver this: the customer last wrote more than a day ago." },
  send: { ok: false, text: "Sending failed. Please try again." },
  owner_only: { ok: false, text: "Only the owner can do that." },
  sent_review: { ok: true, text: "Sent. We'll review your business in 1 to 2 working days and message you on WhatsApp." },
};

export function createOwnerApp(deps: OwnerAppDeps) {
  const app = new Hono<Env>();
  const log = deps.log ?? console;
  const secret = cookieSecret(deps.secret);
  const guard = createGuard("Owner app", { log });
  const now = () => (deps.now ? deps.now() : new Date());
  const secure = (c: AppContext) => new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";

  app.use("*", async (c, next) => {
    // Forms posted from another website are refused (the login cookie would go with them).
    if (c.req.method === "POST" && !sameSite(c)) return c.text("This form must be sent from the yarnOga app itself.", 403);
    await next();
    // Pages are never cached; the logo files set their own (longer) caching.
    if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
  });
  // Photos and logos are the biggest uploads.
  app.use("*", bodyLimit({ maxSize: 6 * 1024 * 1024, onError: (c) => c.text("That file is too big. Please use one under 5 MB.", 413) }));

  app.onError((err, c) => {
    log.error("Owner app page failed:", err);
    return c.html(
      bare(
        "Something went wrong",
        `<h1>Something went wrong</h1><p>The page couldn't load just now. We've been alerted. Please try again in a minute.</p><p><a href="/app">Back to the app</a></p>`,
      ),
      500,
    );
  });

  async function startSession(c: AppContext, user: AppUser) {
    const expires = now().getTime() + SESSION_DAYS * 86_400_000;
    await setSignedCookie(c, COOKIE, sessionValue({ userId: user.id, expires, epoch: user.sessionEpoch }), secret, {
      path: "/app",
      httpOnly: true,
      secure: secure(c),
      sameSite: "Lax",
      maxAge: SESSION_DAYS * 86_400,
    });
    deps.users.touchLogin(user.id).catch((err) => log.warn(`Owner app: couldn't note the login time: ${String(err)}`));
  }

  // The yarnOga logo and mark (assets/brand/web), for the pages and the browser tab.
  app.get("/brand/:file", (c) => {
    const file = BRAND_FILES.has(c.req.param("file")) ? brandFile(c.req.param("file")) : null;
    if (!file) return c.notFound();
    return c.body(file as unknown as ArrayBuffer, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" });
  });

  // ---- Logging in ----

  const loginPage = (error = "", waId = "") =>
    bare(
      "Log in",
      `<h1>Log in</h1>${error ? `<p class="flash bad">${esc(error)}</p>` : ""}
<form method="post" action="/app/login">
<label for="wa">Your WhatsApp number</label><input id="wa" name="wa" inputmode="tel" autocomplete="username" required value="${esc(waId)}" placeholder="0801 234 5678">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
<div class="actions"><button>Log in</button></div></form>
<h2>No password yet?</h2>
<p>Send <b>app</b> to your business's WhatsApp number from your own phone. The bot replies with a link that logs you in. You can set a password in the app afterwards.</p>
<p class="muted small">Trouble logging in? <a href="mailto:${esc(deps.support.email)}">${esc(deps.support.email)}</a></p>`,
    );

  app.get("/login", (c) => c.html(loginPage()));

  app.post("/login", async (c) => {
    const ip = clientIp(c);
    const form = await c.req.parseBody();
    const waId = normaliseWaId(String(form.wa ?? "")) ?? "";
    const password = String(form.password ?? "");
    // Counted per address and per number, so one phone number can't be guessed from many places.
    if (guard.blocked(ip) || (waId && guard.blocked(`wa:${waId}`))) {
      return c.html(loginPage("Too many wrong passwords. Wait 15 minutes and try again, or send app to your bot on WhatsApp."), 429);
    }
    const rows = waId ? await deps.users.byWaId(waId) : [];
    let user: AppUser | null = null;
    for (const r of rows) {
      if (r.passwordHash && (await checkPassword(password, r.passwordHash))) {
        user = r;
        break;
      }
    }
    if (!rows.length) await checkPassword(password, null); // same wait whether or not the number is known
    if (!user) {
      await guard.failed(ip);
      if (waId) await guard.failed(`wa:${waId}`);
      return c.html(loginPage("That number and password don't match.", String(form.wa ?? "")), 401);
    }
    guard.succeeded(ip);
    guard.succeeded(`wa:${waId}`);
    await startSession(c, user);
    return c.redirect("/app", 303);
  });

  // The link from WhatsApp. Opening it only shows a button: link previews and
  // virus scanners open links too, and mustn't use up the one-time link.
  app.get("/l/:token", (c) =>
    c.html(
      bare(
        "Open your app",
        `<h1>See what you've sold today</h1><p class="muted">Orders, money in and delivered orders, all in one place.</p><form method="post" action="/app/l/${esc(c.req.param("token"))}"><button>Open my app</button></form>
<p class="muted small">This link works once. If it's expired, send <b>app</b> to your bot again.</p>`,
      ),
    ),
  );

  app.post("/l/:token", async (c) => {
    const ip = clientIp(c);
    if (guard.blocked(ip)) return c.html(bare("Try later", `<h1>Too many tries</h1><p>Wait 15 minutes, then send <b>app</b> to your bot again.</p>`), 429);
    const userId = await deps.users.useToken(hashToken(c.req.param("token")), now());
    const user = userId ? await deps.users.get(userId) : null;
    if (!user || !user.active) {
      await guard.failed(ip);
      return c.html(
        bare("Link expired", `<h1>This link has expired</h1><p>Each link works once, for 15 minutes. Send <b>app</b> to your bot on WhatsApp for a new one.</p><p><a href="/app/login">Log in with a password</a></p>`),
        410,
      );
    }
    await startSession(c, user);
    return c.redirect("/app", 303);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/app" });
    return c.redirect("/app/login", 303);
  });

  // The Google Sheets link: a private address the sheet reads with
  // =IMPORTDATA(...). It has no login, so its key is long and random, and the
  // owner can change it (Export > new link) to turn the old one off.
  app.get("/sheet/:businessId/:key", async (c) => {
    const ip = clientIp(c);
    if (guard.blocked(ip)) return c.text("Too many tries", 429);
    const key = c.req.param("key").replace(/\.csv$/, "");
    const biz = /^[0-9a-f-]{36}$/.test(c.req.param("businessId")) ? await deps.business(c.req.param("businessId")) : null;
    const info = biz ? await biz.data.info() : null;
    if (!biz || !info?.sheetKey || !sameText(key, info.sheetKey)) {
      await guard.failed(ip);
      return c.text("Not found", 404);
    }
    const to = now();
    const from = new Date(to.getTime() - 365 * 86_400_000);
    const csv = ordersCsv(await biz.data.exportRows(from, to), biz.currency);
    return c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8" });
  });

  // ---- Everything below needs a login ----

  app.use("*", async (c, next) => {
    const session = readSession(await getSignedCookie(c, secret, COOKIE), now().getTime());
    const user = session ? await deps.users.get(session.userId) : null;
    if (!session || !user || !user.active || user.sessionEpoch !== session.epoch) {
      if (c.req.method === "GET") return c.redirect("/app/login", 303);
      return c.text("Please log in again.", 401);
    }
    const biz = await deps.business(user.businessId);
    if (!biz) return c.html(bare("Not set up", `<h1>Your business isn't set up yet</h1><p>Please contact <a href="mailto:${esc(deps.support.email)}">${esc(deps.support.email)}</a>.</p>`), 404);
    const others: Array<{ userId: string; name: string }> = [];
    for (const row of await deps.users.byWaId(user.waId)) {
      if (row.id === user.id) continue;
      const b = await deps.business(row.businessId);
      if (b) others.push({ userId: row.id, name: b.name });
    }
    c.set("user", user);
    c.set("biz", biz);
    c.set("others", others);
    await next();
  });

  app.post("/switch", async (c) => {
    const form = await c.req.parseBody();
    const target = String(form.user ?? "");
    const me = c.get("user");
    const row = target ? (await deps.users.byWaId(me.waId)).find((u) => u.id === target) : undefined;
    if (row) await startSession(c, row);
    return c.redirect("/app", 303);
  });

  const ctx: SectionContext = {
    deps,
    now,
    log,
    relogin: startSession,
    render(c: AppContext, title: string, active: string, body: string, status: 200 | 400 | 404 = 200) {
      const user = c.get("user");
      const flash = FLASH[c.req.query("msg") ?? ""] ?? null;
      return c.html(
        page(
          {
            title,
            active,
            businessName: c.get("biz").name,
            userName: user.name ?? (user.role === "owner" ? "Owner" : "Staff"),
            role: user.role,
            others: c.get("others"),
            flash,
          },
          body,
        ),
        status,
      );
    },
    /** Owners only: staff get a polite page instead. */
    ownerOnly(c: AppContext) {
      return c.get("user").role === "owner"
        ? null
        : ctx.render(c, "Owners only", "", `<p>Only the business owner can open this page.</p><p><a href="/app">Back to the dashboard</a></p>`);
    },
  };

  registerDashboard(app, ctx);
  registerInbox(app, ctx);
  registerOrders(app, ctx);
  registerCustomers(app, ctx);
  registerPrices(app, ctx);
  registerDelivery(app, ctx);
  registerTools(app, ctx);
  registerVerify(app, ctx);
  registerSettings(app, ctx);

  return app;
}

export type SectionContext = {
  deps: OwnerAppDeps;
  now: () => Date;
  log: Pick<Console, "info" | "warn" | "error">;
  render(c: AppContext, title: string, active: string, body: string, status?: 200 | 400 | 404): Response | Promise<Response>;
  ownerOnly(c: AppContext): Response | Promise<Response> | null;
  /** Gives this browser a fresh login (after the person's session epoch changed). */
  relogin(c: AppContext, user: AppUser): Promise<void>;
};

const BRAND_FILES = new Set(["logo-96.png", "mark-128.png", "mark-64.png", "mark-32.png"]);
const brandDir = fileURLToPath(new URL("../../assets/brand/web/", import.meta.url));
const brandCache = new Map<string, Uint8Array | null>();
function brandFile(name: string): Uint8Array | null {
  if (!brandCache.has(name)) {
    try {
      brandCache.set(name, new Uint8Array(readFileSync(brandDir + name)));
    } catch {
      brandCache.set(name, null);
    }
  }
  return brandCache.get(name)!;
}

function sameSite(c: AppContext): boolean {
  if (c.req.header("sec-fetch-site") === "same-origin") return true;
  const origin = c.req.header("origin") ?? c.req.header("referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === c.req.header("host");
  } catch {
    return false;
  }
}
