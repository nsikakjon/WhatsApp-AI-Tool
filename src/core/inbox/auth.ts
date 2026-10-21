import { createHash, timingSafeEqual } from "node:crypto";

// Login for the staff inbox: one shared password (INBOX_PASSWORD). After
// logging in, the browser keeps a signed cookie that stays valid for 30 days.
// Changing the password logs everyone out, because the cookie's signature is
// made from it.

export const SESSION_DAYS = 30;

/** True if `attempt` is the inbox password. Takes the same time whatever the guess. */
export function passwordMatches(attempt: string, password: string): boolean {
  const a = createHash("sha256").update(attempt).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

/** The key that signs login cookies, made from the password and the Meta app secret. */
export function cookieSecret(password: string, appSecret: string): string {
  return createHash("sha256").update(`inbox-session:${password}:${appSecret}`).digest("hex");
}

/**
 * Slows down password guessing: after 5 wrong passwords from one address,
 * that address must wait 15 minutes.
 */
export function createLoginThrottle(maxFailures = 5, windowMs = 15 * 60 * 1000) {
  const failures = new Map<string, { count: number; since: number }>();
  return {
    blocked(ip: string, now = Date.now()): boolean {
      const entry = failures.get(ip);
      if (!entry) return false;
      if (now - entry.since > windowMs) {
        failures.delete(ip);
        return false;
      }
      return entry.count >= maxFailures;
    },
    failed(ip: string, now = Date.now()) {
      const entry = failures.get(ip);
      if (!entry || now - entry.since > windowMs) failures.set(ip, { count: 1, since: now });
      else entry.count += 1;
    },
    succeeded(ip: string) {
      failures.delete(ip);
    },
  };
}
