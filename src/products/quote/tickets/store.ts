import type { SupabaseClient } from "@supabase/supabase-js";

// Event tickets in the database (migration 0068): which price list products
// are tickets, and one row per ticket sold.

export interface EventTicket {
  id: string;
  orderId: string;
  orderNumber: number;
  seat: number;
  /** e.g. "Element House: VIP" */
  name: string;
  code: string;
  holderName: string | null;
  holderWaId: string;
  checkedInAt: Date | null;
}

export interface TicketProduct {
  id: string;
  name: string;
  ticket: boolean;
}

export interface TicketCount {
  name: string;
  sold: number;
  checkedIn: number;
}

export interface TicketStore {
  /** Active products, sorted by name, and whether each is a ticket. */
  products(): Promise<TicketProduct[]>;
  setTicket(productId: string, ticket: boolean): Promise<void>;
  /** Which of these price list rows (variant ids) are tickets. */
  ticketVariants(variantIds: string[]): Promise<Set<string>>;
  /** Saves an order's tickets and returns them all. Running it twice for one order makes nothing new. */
  issue(orderId: string, tickets: Array<{ seat: number; name: string; code: string }>): Promise<EventTicket[]>;
  forOrder(orderId: string): Promise<EventTicket[]>;
  ticket(ticketId: string): Promise<EventTicket | null>;
  /** The ticket with this order number and 4-digit code, for the door typing it in. */
  findByCode(orderNumber: number, code: string): Promise<EventTicket | null>;
  /** Lets a ticket in. Null when it was already in, so a second scan does nothing. */
  checkIn(ticketId: string): Promise<EventTicket | null>;
  /** This customer's tickets bought since `since` that haven't been used yet, oldest first. */
  unusedFor(contactId: string, since: Date): Promise<EventTicket[]>;
  /** Tickets sold and let in since `since`, per ticket name. */
  counts(since: Date): Promise<TicketCount[]>;
}

type Row = {
  id: string;
  order_id: string;
  seat: number;
  name: string;
  code: string;
  checked_in_at: string | null;
  quote_orders: { order_number: number | string; contacts: { wa_id: string; name: string | null } };
};

const COLUMNS = "id, order_id, seat, name, code, checked_in_at, quote_orders!inner(order_number, contact_id, contacts(wa_id, name))";

function toTicket(r: Row): EventTicket {
  return {
    id: r.id,
    orderId: r.order_id,
    orderNumber: Number(r.quote_orders.order_number),
    seat: r.seat,
    name: r.name,
    code: r.code,
    holderName: r.quote_orders.contacts.name,
    holderWaId: r.quote_orders.contacts.wa_id,
    checkedInAt: r.checked_in_at ? new Date(r.checked_in_at) : null,
  };
}

export function createSupabaseTicketStore(db: SupabaseClient, businessId: string): TicketStore {
  const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);
  const many = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
    const { data, error } = await query;
    if (error) throw fail(what, error);
    return ((data ?? []) as Row[]).map(toTicket);
  };
  const tickets = () => db.from("quote_event_tickets").select(COLUMNS).eq("business_id", businessId);

  const store: TicketStore = {
    async products() {
      const { data, error } = await db
        .from("quote_products")
        .select("id, name, ticket")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("name");
      if (error) throw fail("ticket products", error);
      return (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, ticket: Boolean(p.ticket) }));
    },

    async setTicket(productId, ticket) {
      const { error } = await db
        .from("quote_products")
        .update({ ticket, updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("business_id", businessId);
      if (error) throw fail("setTicket", error);
    },

    async ticketVariants(variantIds) {
      if (!variantIds.length) return new Set();
      const { data, error } = await db
        .from("quote_variants")
        .select("id, quote_products!inner(ticket)")
        .in("id", variantIds)
        .eq("quote_products.ticket", true);
      if (error) throw fail("ticketVariants", error);
      return new Set((data ?? []).map((v) => v.id as string));
    },

    async issue(orderId, list) {
      if (list.length) {
        const { error } = await db
          .from("quote_event_tickets")
          .upsert(
            list.map((t) => ({ business_id: businessId, order_id: orderId, ...t })),
            { onConflict: "order_id,seat", ignoreDuplicates: true },
          );
        if (error) throw fail("issue tickets", error);
      }
      return store.forOrder(orderId);
    },

    forOrder: (orderId) => many(tickets().eq("order_id", orderId).order("seat"), "tickets for order"),

    async ticket(ticketId) {
      return (await many(tickets().eq("id", ticketId).limit(1), "ticket"))[0] ?? null;
    },

    async findByCode(orderNumber, code) {
      return (await many(tickets().eq("quote_orders.order_number", orderNumber).eq("code", code).limit(1), "ticket by code"))[0] ?? null;
    },

    async checkIn(ticketId) {
      const { data, error } = await db
        .from("quote_event_tickets")
        .update({ checked_in_at: new Date().toISOString() })
        .eq("id", ticketId)
        .eq("business_id", businessId)
        .is("checked_in_at", null)
        .select(COLUMNS);
      if (error) throw fail("checkIn", error);
      const row = (data ?? [])[0] as unknown as Row | undefined;
      return row ? toTicket(row) : null;
    },

    unusedFor: (contactId, since) =>
      many(
        tickets()
          .eq("quote_orders.contact_id", contactId)
          .is("checked_in_at", null)
          .gte("created_at", since.toISOString())
          .order("created_at")
          .order("seat")
          .limit(50),
        "unused tickets",
      ),

    async counts(since) {
      const { data, error } = await db
        .from("quote_event_tickets")
        .select("name, checked_in_at")
        .eq("business_id", businessId)
        .gte("created_at", since.toISOString())
        .limit(20_000);
      if (error) throw fail("ticket counts", error);
      const byName = new Map<string, TicketCount>();
      for (const r of data ?? []) {
        const name = r.name as string;
        const count = byName.get(name) ?? { name, sold: 0, checkedIn: 0 };
        count.sold += 1;
        if (r.checked_in_at) count.checkedIn += 1;
        byName.set(name, count);
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
  return store;
}
