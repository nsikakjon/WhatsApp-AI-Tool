import type { SupabaseClient } from "@supabase/supabase-js";
import { lagosHour } from "./followups.js";

// Ratings: once an order is done, the customer is asked how it went, with
// three buttons (Great, OK, Not good) rather than a typed number, so a rating
// can never be mixed up with a quantity. One question per order, daytime
// only, inside WhatsApp's free 24-hour window. A "Not good" reaches the owner
// at once.

/** Stars each button stands for. */
export const STARS = { great: 5, ok: 3, bad: 1 } as const;
/** A button tap comes back as "rate KP-1001 5". */
export const RATE = /^rate ([a-z0-9]+-\d+) ([135])$/i;

/** Hours after payment before asking, when there's no delivery to wait for. */
const AFTER_PAID_HOURS = 3;
/** Minutes after a delivery before asking. */
const AFTER_DELIVERED_MINUTES = 30;
/** Orders older than this aren't asked about. */
const LOOK_BACK_HOURS = 48;

export interface RatingCandidate {
  id: string;
  orderNumber: number;
  contactId: string;
  customerWaId: string;
  paidAt: Date;
  /** The delivery's status and when it was delivered; null without a delivery. */
  delivery: { status: string; deliveredAt: Date | null } | null;
}

export interface RatingStore {
  /** Paid orders of this business since `since` that haven't been asked about. */
  candidates(businessId: string, since: Date): Promise<RatingCandidate[]>;
  /** Records that the question went out; false if it already had. */
  markAsked(orderId: string): Promise<boolean>;
  /** Saves the customer's rating for their own order, once. False when it isn't theirs or was already rated. */
  save(businessId: string, orderNumber: number, customerWaId: string, stars: number): Promise<boolean>;
}

/** Whether to ask about an order now: some hours after payment, or soon after delivery; never while a delivery is on its way. */
export function shouldAsk(c: Pick<RatingCandidate, "paidAt" | "delivery">, now: Date): boolean {
  const since = (d: Date) => (now.getTime() - d.getTime()) / 60_000;
  if (since(c.paidAt) > LOOK_BACK_HOURS * 60) return false;
  if (!c.delivery || c.delivery.status === "pickup" || c.delivery.status === "cancelled") return since(c.paidAt) >= AFTER_PAID_HOURS * 60;
  if (c.delivery.status !== "delivered" || !c.delivery.deliveredAt) return false;
  return since(c.delivery.deliveredAt) >= AFTER_DELIVERED_MINUTES;
}

export interface RatingAskDeps {
  store: RatingStore;
  canMessageFreely(waId: string): Promise<boolean>;
  isPaused(contactId: string): Promise<boolean>;
  optedOut?(contactId: string): Promise<boolean>;
  /** The question with its buttons, in the business's language. */
  send(to: string, orderNumber: number): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

export async function askForRatings(businessId: string, deps: RatingAskDeps): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  const hour = lagosHour(now);
  if (hour < 9 || hour >= 20) return 0;
  let asked = 0;
  for (const c of await deps.store.candidates(businessId, new Date(now.getTime() - LOOK_BACK_HOURS * 3_600_000))) {
    if (!shouldAsk(c, now)) continue;
    try {
      if (!(await deps.canMessageFreely(c.customerWaId)) || (await deps.isPaused(c.contactId)) || (deps.optedOut && (await deps.optedOut(c.contactId)))) continue;
      if (!(await deps.store.markAsked(c.id))) continue;
      await deps.send(c.customerWaId, c.orderNumber);
      asked++;
    } catch (err) {
      (deps.log ?? console).error(`Asking for a rating on order ${c.orderNumber} failed:`, err);
    }
  }
  return asked;
}

export function createSupabaseRatings(db: SupabaseClient): RatingStore {
  return {
    async candidates(businessId, since) {
      const { data, error } = await db
        .from("quote_orders")
        .select("id, order_number, contact_id, paid_at, contacts(wa_id), quote_deliveries(status, delivered_at)")
        .eq("business_id", businessId)
        .eq("status", "paid")
        .is("rating_asked_at", null)
        .gte("paid_at", since.toISOString())
        .limit(100);
      if (error) throw new Error(`rating candidates failed: ${error.message}`);
      return (data ?? []).flatMap((r) => {
        const contact = (Array.isArray(r.contacts) ? r.contacts[0] : r.contacts) as { wa_id?: string } | null;
        const d = (Array.isArray(r.quote_deliveries) ? r.quote_deliveries[0] : r.quote_deliveries) as { status?: string; delivered_at?: string | null } | null;
        if (!contact?.wa_id || !r.paid_at) return [];
        return [
          {
            id: r.id as string,
            orderNumber: Number(r.order_number),
            contactId: r.contact_id as string,
            customerWaId: contact.wa_id,
            paidAt: new Date(r.paid_at as string),
            delivery: d?.status ? { status: d.status, deliveredAt: d.delivered_at ? new Date(d.delivered_at) : null } : null,
          },
        ];
      });
    },

    async markAsked(orderId) {
      const { data, error } = await db.from("quote_orders").update({ rating_asked_at: new Date().toISOString() }).eq("id", orderId).is("rating_asked_at", null).select("id");
      if (error) throw new Error(`rating ask failed: ${error.message}`);
      return (data ?? []).length === 1;
    },

    async save(businessId, orderNumber, customerWaId, stars) {
      const { data: order, error: e1 } = await db
        .from("quote_orders")
        .select("id, contacts(wa_id)")
        .eq("business_id", businessId)
        .eq("order_number", orderNumber)
        .maybeSingle();
      if (e1) throw new Error(`rating lookup failed: ${e1.message}`);
      const contact = order ? ((Array.isArray(order.contacts) ? order.contacts[0] : order.contacts) as { wa_id?: string } | null) : null;
      if (!order || contact?.wa_id !== customerWaId) return false;
      const { data, error } = await db
        .from("quote_orders")
        .update({ rating: stars, rated_at: new Date().toISOString() })
        .eq("id", order.id)
        .is("rating", null)
        .select("id");
      if (error) throw new Error(`save rating failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
