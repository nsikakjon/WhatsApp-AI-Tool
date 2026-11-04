import { createHmac, timingSafeEqual } from "node:crypto";

// Signed links for event tickets, so nobody can make up a ticket or find a
// business's door screen:
//   /ticket/<business>.<ticket>.<sig>   what each ticket's QR code holds
//   /door/<business>.<sig>              the door screen that checks tickets in

const UUID = /^[0-9a-f-]{36}$/;

function sign(secret: string, what: string): string {
  return createHmac("sha256", secret).update(what).digest("base64url").slice(0, 24);
}

function matches(secret: string, what: string, sig: string): boolean {
  const expected = Buffer.from(sign(secret, what));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface TicketLinks {
  ticket(businessId: string, ticketId: string): string;
  door(businessId: string): string;
}

export function createTicketLinks(secret: string, publicUrl: string): TicketLinks {
  const base = publicUrl.replace(/\/+$/, "");
  return {
    ticket: (businessId, ticketId) => `${base}/ticket/${businessId}.${ticketId}.${sign(secret, `ticket:${businessId}:${ticketId}`)}`,
    door: (businessId) => `${base}/door/${businessId}.${sign(secret, `door:${businessId}`)}`,
  };
}

export function readTicketToken(secret: string, token: string): { businessId: string; ticketId: string } | null {
  const [businessId, ticketId, sig] = token.split(".");
  if (!businessId || !ticketId || !sig || !UUID.test(businessId) || !UUID.test(ticketId)) return null;
  return matches(secret, `ticket:${businessId}:${ticketId}`, sig) ? { businessId, ticketId } : null;
}

export function readDoorToken(secret: string, token: string): string | null {
  const [businessId, sig] = token.split(".");
  if (!businessId || !sig || !UUID.test(businessId)) return null;
  return matches(secret, `door:${businessId}`, sig) ? businessId : null;
}
