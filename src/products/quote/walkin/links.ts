import { createHmac, timingSafeEqual } from "node:crypto";

// Signed links for walk-in orders, so nobody can guess another business's
// screen or another customer's order:
//   /screen/<business>.<station>.<sig>   a pickup screen (station "*" = every screen)
//   /pickup/<business>.<order>.<sig>     what the receipt's QR code opens

const UUID = /^[0-9a-f-]{36}$/;
export const ALL_STATIONS = "*";

function sign(secret: string, what: string): string {
  return createHmac("sha256", secret).update(what).digest("base64url").slice(0, 24);
}

function matches(secret: string, what: string, sig: string): boolean {
  const expected = Buffer.from(sign(secret, what));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WalkInLinks {
  screen(businessId: string, station: string): string;
  pickup(businessId: string, orderId: string): string;
}

export function createWalkInLinks(secret: string, publicUrl: string): WalkInLinks {
  const base = publicUrl.replace(/\/+$/, "");
  return {
    screen(businessId, station) {
      const s = Buffer.from(station).toString("base64url");
      return `${base}/screen/${businessId}.${s}.${sign(secret, `screen:${businessId}:${station}`)}`;
    },
    pickup(businessId, orderId) {
      return `${base}/pickup/${businessId}.${orderId}.${sign(secret, `pickup:${businessId}:${orderId}`)}`;
    },
  };
}

export function readScreenToken(secret: string, token: string): { businessId: string; station: string } | null {
  const [businessId, s, sig] = token.split(".");
  if (!businessId || !s || !sig || !UUID.test(businessId)) return null;
  const station = Buffer.from(s, "base64url").toString("utf8");
  return station && matches(secret, `screen:${businessId}:${station}`, sig) ? { businessId, station } : null;
}

export function readPickupToken(secret: string, token: string): { businessId: string; orderId: string } | null {
  const [businessId, orderId, sig] = token.split(".");
  if (!businessId || !orderId || !sig || !UUID.test(businessId) || !UUID.test(orderId)) return null;
  return matches(secret, `pickup:${businessId}:${orderId}`, sig) ? { businessId, orderId } : null;
}
