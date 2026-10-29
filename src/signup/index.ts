import { randomInt } from "node:crypto";
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
  /** Adds the number to yarnOga as a switched-off business; true if it was new. */
  onConnected?: (connection: Connection) => Promise<boolean>;
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

  app.get("/", (c) => {
    c.header("Cache-Control", "no-store");
    return c.html(
      renderSignupPage({ appId: deps.app.appId, configId: deps.configId, graphApiVersion: deps.app.graphApiVersion }),
    );
  });

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
    });
  });

  return app;
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}
