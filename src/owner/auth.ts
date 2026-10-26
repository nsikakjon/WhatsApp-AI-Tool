import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Logging in to the owner app. Two ways in:
//   1. Send "app" to the business's WhatsApp number from an owner or staff
//      number: the bot replies with a link that works once, for 15 minutes.
//      Having the phone proves who you are, so no password is needed.
//   2. WhatsApp number and password, once one is set in Settings. Guessing is
//      slowed down (core/security/guard.ts) per address and per number.
// After either, the browser keeps a signed cookie for 30 days.

export const SESSION_DAYS = 30;
export const LINK_MINUTES = 15;
export const MIN_PASSWORD = 10;

/** A new login link's secret, and the hash kept in the database. */
export function newLoginToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "scrypt$<salt>$<hash>": slow on purpose, so a stolen hash is hard to guess from. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split("$");
  if (!parts || parts.length !== 3 || parts[0] !== "scrypt") {
    // Take about as long as a real check, so timing doesn't say whether a password is set.
    await scryptAsync(password, Buffer.alloc(16));
    return false;
  }
  const expected = Buffer.from(parts[2]!, "base64");
  const actual = await scryptAsync(password, Buffer.from(parts[1]!, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Problems with a new password, or null when it's fine. */
export function passwordProblem(password: string, waId: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 200) return "That's too long. Use at most 200 characters.";
  if (password.replace(/\D/g, "") === waId || /^(.)\1+$/.test(password)) return "That's too easy to guess.";
  if (/^(password|1234567890|qwertyuiop)/i.test(password)) return "That's too easy to guess.";
  return null;
}

/** What the login cookie holds: who, until when, and their session epoch. */
export interface Session {
  userId: string;
  expires: number;
  epoch: number;
}

export function sessionValue(s: Session): string {
  return `${s.userId}.${s.expires}.${s.epoch}`;
}

export function readSession(value: string | false | undefined, now = Date.now()): Session | null {
  if (!value) return null;
  const [userId, expires, epoch] = value.split(".");
  if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) return null;
  const s = { userId, expires: Number(expires), epoch: Number(epoch) };
  if (!Number.isFinite(s.expires) || s.expires <= now || !Number.isInteger(s.epoch)) return null;
  return s;
}

/** The key that signs the app's cookies, made from the server's secret. */
export function cookieSecret(secret: string): string {
  return createHmac("sha256", secret).update("owner-app-session").digest("hex");
}

/** "+234 801 234 5678" or "08012345678" -> "2348012345678"; null when it isn't a phone number. */
export function normaliseWaId(text: string): string | null {
  let digits = text.replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) digits = `234${digits.slice(1)}`; // a Nigerian number typed locally
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Constant-time comparison of two strings, e.g. a link's key. */
export function sameText(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}
