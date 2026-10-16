import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { exchangeCode, phoneDetails, subscribeApp, type MetaApp } from "./meta.js";
import { renderSignupPage } from "./page.js";
import type { ConnectionStore } from "./store.js";

// The sign-up page at /signup, where a business connects its WhatsApp number
// to the bot through Meta's pop-up ("Embedded Signup"). Switched off unless
// SIGNUP_PASSWORD is set, and the browser asks for that password (any
// username works), so strangers can't attach numbers to the bot.

export interface SignupDeps {
  password: string;
  app: MetaApp;
  /** The "Facebook Login for Business" configuration made for Embedded Signup. */
  configId: string;
  store: ConnectionStore;
  fetch?: typeof fetch;
  log?: Pick<Console, "info" | "error">;
}

export function createSignup(deps: SignupDeps) {
  const app = new Hono();
  const log = deps.log ?? console;
  const doFetch = deps.fetch ?? fetch;

  app.use(
    "*",
    basicAuth({
      verifyUser: (_username, password) => samePassword(password, deps.password),
      realm: "WhatsApp sign-up",
    }),
  );

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
      return c.json({ error: "Meta didn't send back the account details." }, 400);
    }

    try {
      const token = await exchangeCode(doFetch, deps.app, code);
      await subscribeApp(doFetch, deps.app, wabaId, token);
      const details = await phoneDetails(doFetch, deps.app, phoneNumberId, token).catch((err) => {
        log.error("Couldn't read the connected number's details:", err);
        return {} as { displayNumber?: string; verifiedName?: string };
      });
      await deps.store.save({
        phoneNumberId,
        wabaId,
        displayNumber: details.displayNumber,
        verifiedName: details.verifiedName,
        coexistence: body.coexistence === true,
        businessToken: token,
      });
      log.info(`Connected WhatsApp number ${phoneNumberId} (account ${wabaId}, coexistence: ${body.coexistence === true})`);
      const name = details.displayNumber ? `${details.displayNumber} is` : "Your number is";
      return c.json({
        message: `${name} connected. Its Phone number ID is ${phoneNumberId}. Send that ID to the yarnOga team to switch the bot on for it.`,
        phoneNumberId,
      });
    } catch (err) {
      log.error("Sign-up didn't finish:", err);
      return c.json({ error: "Meta didn't accept the connection." }, 502);
    }
  });

  return app;
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

/** Compares in constant time, so response timing can't reveal the password letter by letter. */
function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
