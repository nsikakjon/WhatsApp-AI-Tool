import { createHash } from "node:crypto";
import { createLoginThrottle, samePassword } from "../security/guard.js";

// Login for the staff inbox: one shared password (INBOX_PASSWORD). After
// logging in, the browser keeps a signed cookie that stays valid for 30 days.
// Changing the password logs everyone out, because the cookie's signature is
// made from it.

export const SESSION_DAYS = 30;

/** True if `attempt` is the inbox password. Takes the same time whatever the guess. */
export const passwordMatches = samePassword;

/** The key that signs login cookies, made from the password and the Meta app secret. */
export function cookieSecret(password: string, appSecret: string): string {
  return createHash("sha256").update(`inbox-session:${password}:${appSecret}`).digest("hex");
}

// After 5 wrong passwords from one address, that address must wait 15 minutes
// (shared with every other owner page, see core/security/guard.ts).
export { createLoginThrottle };
