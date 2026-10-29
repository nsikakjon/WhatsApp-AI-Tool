import type { SupabaseClient } from "@supabase/supabase-js";
import { lagosHour } from "./followups.js";

// Reminders for orders that were confirmed but never paid. At most two per
// order: one about 3 hours after the customer said yes, one about 20 hours
// after. Both fall inside WhatsApp's free 24-hour window from the customer's
// last message; when that window has closed, the reminder is skipped rather
// than sent as a paid template. Daytime only (8am to 8pm Lagos time), never
// to someone who said STOP, and never while staff have taken over the chat.

export const MAX_REMINDERS = 2;
/** Hours after confirming when each reminder is due. */
export const REMINDER_HOURS = [3, 20] as const;
/** Orders older than this are left alone (e.g. when reminders are first switched on). */
const LOOK_BACK_HOURS = 26;
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

export interface UnpaidOrder {
  id: string;
  orderNumber: number;
  contactId: string;
  customerWaId: string;
  confirmedAt: Date;
  /** Reminders already sent (0 or 1). */
  reminders: number;
}

export interface PayReminderStore {
  /** Confirmed, unpaid orders of this business confirmed since `since`, with fewer than two reminders. */
  unpaid(businessId: string, since: Date): Promise<UnpaidOrder[]>;
  /**
   * Records reminder `n` for an order that's still confirmed and has had
   * n - 1 reminders. False if it was paid, cancelled or reminded meanwhile,
   * so two servers (or a retry) never send the same reminder twice.
   */
  claim(orderId: string, n: number): Promise<boolean>;
}

/** Which reminder is due for an order now (1 or 2), or null. */
export function reminderDue(order: Pick<UnpaidOrder, "confirmedAt" | "reminders">, now: Date): 1 | 2 | null {
  if (order.reminders >= MAX_REMINDERS) return null;
  const hours = (now.getTime() - order.confirmedAt.getTime()) / 3_600_000;
  const next = order.reminders + 1;
  if (hours > LOOK_BACK_HOURS || hours < REMINDER_HOURS[order.reminders]!) return null;
  // A first reminder that was missed (e.g. at night) isn't sent so late that it lands on top of the second.
  if (next === 1 && hours >= REMINDER_HOURS[1]) return null;
  return next as 1 | 2;
}

export interface PayReminderDeps {
  store: PayReminderStore;
  /** True while we may still send them ordinary (free) messages. */
  canMessageFreely(waId: string): Promise<boolean>;
  isPaused(contactId: string): Promise<boolean>;
  /** The customer replied STOP to reminders. */
  optedOut?(contactId: string): Promise<boolean>;
  /** The reminder's words, with a fresh pay link or the bank details; null when the order no longer needs one. */
  remind(orderNumber: number, n: 1 | 2): Promise<string | null>;
  sendText(to: string, text: string): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

export async function sendPayReminders(businessId: string, deps: PayReminderDeps): Promise<{ sent: number; skipped: number }> {
  const result = { sent: 0, skipped: 0 };
  const now = deps.now ? deps.now() : new Date();
  const hour = lagosHour(now);
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return result;
  const orders = await deps.store.unpaid(businessId, new Date(now.getTime() - LOOK_BACK_HOURS * 3_600_000));
  for (const order of orders) {
    const n = reminderDue(order, now);
    if (!n) continue;
    try {
      if (
        !(await deps.canMessageFreely(order.customerWaId)) ||
        (await deps.isPaused(order.contactId)) ||
        (deps.optedOut && (await deps.optedOut(order.contactId)))
      ) {
        result.skipped++;
        continue;
      }
      const text = await deps.remind(order.orderNumber, n);
      if (!text) continue;
      // Claimed first: if two servers race, only one sends.
      if (!(await deps.store.claim(order.id, n))) continue;
      await deps.sendText(order.customerWaId, text);
      result.sent++;
    } catch (err) {
      (deps.log ?? console).error(`Payment reminder ${n} for order ${order.orderNumber} failed:`, err);
    }
  }
  return result;
}

export function createSupabasePayReminders(db: SupabaseClient): PayReminderStore {
  return {
    async unpaid(businessId, since) {
      const { data, error } = await db
        .from("quote_orders")
        .select("id, order_number, contact_id, confirmed_at, pay_reminders, contacts(wa_id)")
        .eq("business_id", businessId)
        .eq("status", "confirmed")
        .lt("pay_reminders", MAX_REMINDERS)
        .gte("confirmed_at", since.toISOString())
        .order("confirmed_at")
        .limit(100);
      if (error) throw new Error(`unpaid orders failed: ${error.message}`);
      return (data ?? []).flatMap((r) => {
        const contact = (Array.isArray(r.contacts) ? r.contacts[0] : r.contacts) as { wa_id?: string } | null;
        if (!contact?.wa_id || !r.confirmed_at) return [];
        return [
          {
            id: r.id as string,
            orderNumber: Number(r.order_number),
            contactId: r.contact_id as string,
            customerWaId: contact.wa_id,
            confirmedAt: new Date(r.confirmed_at as string),
            reminders: Number(r.pay_reminders ?? 0),
          },
        ];
      });
    },

    async claim(orderId, n) {
      const { data, error } = await db
        .from("quote_orders")
        .update({ pay_reminders: n, pay_reminded_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("status", "confirmed")
        .eq("pay_reminders", n - 1)
        .select("id");
      if (error) throw new Error(`payment reminder claim failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
