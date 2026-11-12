import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { createDailyLimiter } from "../generator/index.js";
import { exchangeCode, phoneDetails, registerNumber, subscribeApp, type MetaApp } from "./meta.js";
import { renderSignupPage } from "./page.js";
import type { Connection, ConnectionStore } from "./store.js";

// The public sign-up page at /signup, where a business connects its WhatsApp
// number to yarnOga through Meta's pop-up ("Embedded Signup"): either a number
// that stays in the WhatsApp Business app (coexistence) or a new number.
// Switched off unless META_SIGNUP_CONFIG_ID is set. Anyone can open it, which
// is safe because a newly connected number gets a switched-off business: the
// assistant stays quiet on it until we add the price list and switch it on.

export interface SignupDeps {
  app: MetaApp;
  /** The "Facebook Login for Business" configuration made for Embedded Signup. */
  configId: string;
  store: ConnectionStore;
  /** Runs once a number is saved, e.g. to make its message templates. A failure here never fails the sign-up. */
  afterConnect?: (connection: Connection) => Promise<void>;
  /** Adds the number to yarnOga as a switched-off business; true if it was new. */
  onConnected?: (connection: Connection) => Promise<boolean>;
  /**
   * Businesses that signed up by chat get their own link (signupLink). The
   * page shows their name, and the number goes to that business instead of a new one.
   */
  forBusiness?: {
    name: (businessId: string) => Promise<string | null>;
    /** Puts the number on the business and switches it on; false when another business has the number. */
    connected: (businessId: string, connection: Connection) => Promise<boolean>;
  };
  /**
   * Saves the email the owner types after connecting, for receipts and, if
   * ticked, setup tips. "bad" or "typo" when it doesn't look right. Off when not given.
   */
  saveEmail?: (a: { phoneNumberId: string; email: string; tips: boolean }) => Promise<"bad" | "typo" | null>;
  /** Finished sign-ups allowed per visitor and in total each day. */
  perVisitorDailyLimit?: number;
  dailyLimit?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: Pick<Console, "info" | "error">;
}

export function createSignup(deps: SignupDeps) {
  const app = new Hono();
  const log = deps.log ?? console;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const limiter = createDailyLimiter(deps.perVisitorDailyLimit ?? 5, deps.dailyLimit ?? 50);

  app.get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    const businessId = linkedBusiness(c.req.query("b"), c.req.query("t"));
    const businessName = businessId ? await deps.forBusiness!.name(businessId).catch((err) => {
      log.error("Couldn't read the business for a sign-up link:", err);
      return null;
    }) : null;
    return c.html(
      renderSignupPage({
        appId: deps.app.appId,
        configId: deps.configId,
        graphApiVersion: deps.app.graphApiVersion,
        askEmail: Boolean(deps.saveEmail) && !businessName,
        business: businessId && businessName ? { name: businessName, id: businessId, token: c.req.query("t")! } : undefined,
      }),
    );
  });

  /** The business a sign-up link is for, when its token is right. */
  function linkedBusiness(id: unknown, token: unknown): string | undefined {
    if (!deps.forBusiness) return undefined;
    const businessId = matching(id, /^[0-9a-f-]{36}$/i);
    const t = matching(token, /^[\w-]{1,64}$/);
    return businessId && t && sameToken(t, businessToken(deps.app.appSecret, businessId)) ? businessId : undefined;
  }

  app.post("/complete", async (c) => {
    c.header("Cache-Control", "no-store");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const code = matching(body.code, /^\S{1,2048}$/);
    const wabaId = matching(body.waba_id, /^\d{1,32}$/);
    const phoneNumberId = matching(body.phone_number_id, /^\d{1,32}$/);
    if (!code || !wabaId || !phoneNumberId) {
      return c.json({ error: "Meta didn't send back your WhatsApp account and number." }, 400);
    }
    const visitor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (limiter.take(visitor, now()) !== "ok") {
      return c.json({ error: "Too many sign-ups today. Please try again tomorrow or email support@yarnoga.com." }, 429);
    }

    const coexistence = body.coexistence === true;
    let connection: Connection;
    let pin: string | undefined;
    try {
      const token = await exchangeCode(doFetch, deps.app, code);
      await subscribeApp(doFetch, deps.app, wabaId, token);
      if (!coexistence) {
        pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await registerNumber(doFetch, deps.app, phoneNumberId, token, pin);
      }
      const details = await phoneDetails(doFetch, deps.app, phoneNumberId, token).catch((err) => {
        log.error("Couldn't read the connected number's details:", err);
        return {} as { displayNumber?: string; verifiedName?: string };
      });
      connection = { phoneNumberId, wabaId, ...details, coexistence, businessToken: token };
      await deps.store.save(connection);
    } catch (err) {
      log.error("Sign-up didn't finish:", err);
      return c.json({ error: "Meta didn't accept the connection." }, 502);
    }
    log.info(`Connected WhatsApp number ${phoneNumberId} (account ${wabaId}, coexistence: ${coexistence})`);
    void deps.afterConnect?.(connection).catch((err) => log.error(`Couldn't run the steps after connecting ${phoneNumberId}:`, err));

    const businessId = linkedBusiness(body.business, body.token);
    if (businessId) {
      const live = await deps.forBusiness!.connected(businessId, connection).catch((err) => {
        log.error(`Couldn't put ${phoneNumberId} on business ${businessId}:`, err);
        return false;
      });
      return c.json({ number: connection.displayNumber ?? null, name: connection.verifiedName ?? null, phoneNumberId, coexistence, pin: pin ?? null, live });
    }

    const added = await deps.onConnected?.(connection).catch((err) => {
      log.error(`Couldn't add ${phoneNumberId} as a business:`, err);
      return false;
    });
    return c.json({
      number: connection.displayNumber ?? null,
      name: connection.verifiedName ?? null,
      phoneNumberId,
      coexistence,
      pin: pin ?? null,
      added: added ?? false,
      // Proves the email form that follows comes from whoever just connected this number.
      ...(deps.saveEmail && added ? { emailToken: emailToken(deps.app.appSecret, phoneNumberId) } : {}),
    });
  });

  app.post("/email", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!deps.saveEmail) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const phoneNumberId = matching(body.phone_number_id, /^\d{1,32}$/);
    const token = matching(body.token, /^[\w-]{1,64}$/);
    const email = typeof body.email === "string" ? body.email.slice(0, 200) : "";
    if (!phoneNumberId || !token || !sameToken(token, emailToken(deps.app.appSecret, phoneNumberId))) return c.json({ error: "This page has expired. Please add your email in the yarnOga app instead." }, 403);
    try {
      const problem = await deps.saveEmail({ phoneNumberId, email, tips: body.tips === true });
      if (problem === "typo") return c.json({ error: "That email looks mistyped (for example gamil.com instead of gmail.com). Please check it." }, 400);
      if (problem) return c.json({ error: "That email address doesn't look right. Please check it." }, 400);
    } catch (err) {
      log.error("Couldn't save the email from the sign-up page:", err);
      return c.json({ error: "We couldn't save it just now. Please add your email in the yarnOga app instead." }, 500);
    }
    return c.json({ ok: true });
  });

  return app;
}

/** A business's own link to connect its number on /signup. */
export function signupLink(appSecret: string, publicUrl: string, businessId: string): string {
  return `${publicUrl}/signup?b=${businessId}&t=${businessToken(appSecret, businessId)}`;
}

function businessToken(secret: string, businessId: string): string {
  return createHmac("sha256", secret).update(`signup-business:${businessId}`).digest("base64url").slice(0, 32);
}

function emailToken(secret: string, phoneNumberId: string): string {
  return createHmac("sha256", secret).update(`signup-email:${phoneNumberId}`).digest("base64url").slice(0, 32);
}

function sameToken(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}
