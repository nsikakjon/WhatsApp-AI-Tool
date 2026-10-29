import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

// Slows down password guessing on every owner page (dashboard, quote setup,
// bot test, owner app). Each wrong password:
//   - waits a moment before answering, so guesses can't be fired off quickly;
//   - is counted against the address it came from: after 5 wrong passwords in
//     15 minutes that address is locked out for the rest of the 15 minutes;
//   - is counted against everyone too: after 30 wrong passwords in 15 minutes
//     from anywhere, the page is locked for everyone for a while, in case the
//     guesses come from many addresses at once.
// The right password from a locked-out address is still refused until the
// lock ends, otherwise the lock wouldn't stop anything.

/** True if `attempt` is the password. Takes the same time whatever the guess. */
export function samePassword(attempt: string, password: string): boolean {
  const a = createHash("sha256").update(attempt).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

export interface Throttle {
  blocked(key: string, now?: number): boolean;
  failed(key: string, now?: number): void;
  succeeded(key: string): void;
}

/** Counts wrong passwords per key (an address, a phone number, or "all"). */
export function createLoginThrottle(maxFailures = 5, windowMs = 15 * 60 * 1000): Throttle {
  const failures = new Map<string, { count: number; since: number }>();
  return {
    blocked(key, now = Date.now()) {
      const entry = failures.get(key);
      if (!entry) return false;
      if (now - entry.since > windowMs) {
        failures.delete(key);
        return false;
      }
      return entry.count >= maxFailures;
    },
    failed(key, now = Date.now()) {
      const entry = failures.get(key);
      if (!entry || now - entry.since > windowMs) failures.set(key, { count: 1, since: now });
      else entry.count += 1;
      // Keep memory bounded if someone sprays from many addresses.
      if (failures.size > 10_000) {
        for (const [k, e] of failures) if (now - e.since > windowMs) failures.delete(k);
      }
    },
    succeeded(key) {
      failures.delete(key);
    },
  };
}

/** The visitor's address as Railway passes it on. */
export function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export interface GuardOptions {
  /** One wrong password per address before the lock. Default 5. */
  perAddress?: number;
  /** Wrong passwords from everyone before the page locks for all. Default 30. */
  everyone?: number;
  /** How long a wrong password waits before its answer, in ms. Default 750. */
  failDelayMs?: number;
  log?: Pick<Console, "warn">;
}

/** A pair of throttles (per address and for everyone) and the wait after a wrong password. */
export function createGuard(name: string, opts: GuardOptions = {}) {
  const perAddress = createLoginThrottle(opts.perAddress ?? 5);
  const all = createLoginThrottle(opts.everyone ?? 30);
  const delay = opts.failDelayMs ?? 750;
  const log = opts.log ?? console;
  return {
    blocked: (ip: string) => perAddress.blocked(ip) || all.blocked("all"),
    async failed(ip: string) {
      perAddress.failed(ip);
      all.failed("all");
      log.warn(`${name}: wrong password`);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    },
    succeeded: (ip: string) => perAddress.succeeded(ip),
  };
}

/**
 * The browser's own password box (HTTP Basic auth), with guessing slowed down.
 * Any username is accepted; only the password counts.
 */
export function guardedBasicAuth(opts: GuardOptions & { password: string; realm: string }): MiddlewareHandler {
  const guard = createGuard(opts.realm, opts);
  const challenge = (c: Context, status: 401 | 429, text: string) => {
    c.header("WWW-Authenticate", `Basic realm="${opts.realm.replace(/"/g, "")}"`);
    c.header("Cache-Control", "no-store");
    return c.text(text, status);
  };
  return async (c, next) => {
    const ip = clientIp(c);
    const given = readBasicPassword(c.req.header("authorization"));
    if (given === null) return challenge(c, 401, "Please type the password.");
    if (guard.blocked(ip)) {
      c.header("Retry-After", "900");
      return c.text("Too many wrong passwords. Wait 15 minutes and try again.", 429);
    }
    if (!samePassword(given, opts.password)) {
      await guard.failed(ip);
      return challenge(c, 401, "That password isn't right.");
    }
    guard.succeeded(ip);
    await next();
  };
}

function readBasicPassword(header: string | undefined): string | null {
  const m = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1);
}
