import type { SupabaseClient } from "@supabase/supabase-js";

// Walk-in orders in the database (migration 0047): the business's walk-in
// and paused switches, which screen makes each product, the table a
// customer said they're at, and one ticket per screen for each paid order.

export type TicketStatus = "making" | "ready" | "collected";

export interface Ticket {
  id: string;
  orderId: string;
  orderNumber: number;
  station: string;
  /** e.g. "2 x Drinks: Desperados, 1 x Water" */
  items: string;
  status: TicketStatus;
  tableLabel: string | null;
  customerName: string | null;
  customerWaId: string;
  createdAt: Date;
  readyAt: Date | null;
  collectedAt: Date | null;
}

export interface PickupOrder {
  id: string;
  orderNumber: number;
  status: "quoted" | "confirmed" | "paid" | "cancelled";
  totalKobo: number;
  /** e.g. "2 x Drinks: Desperados, 1 x Water" */
  items: string;
  tableLabel: string | null;
  pickupCode: string | null;
  customerName: string | null;
  customerWaId: string;
  createdAt: Date;
}

export interface WalkInSettings {
  walkIn: boolean;
  paused: boolean;
}

export interface StationProduct {
  id: string;
  name: string;
  station: string | null;
}

export interface WalkInStore {
  settings(): Promise<WalkInSettings>;
  setSettings(change: Partial<WalkInSettings>): Promise<void>;
  /** Active products, sorted by name, with the screen that makes each. */
  products(): Promise<StationProduct[]>;
  setStation(productId: string, station: string | null): Promise<void>;
  /** The screen for each price list row (variant id); null = the Counter. */
  stationsOf(variantIds: string[]): Promise<Map<string, string | null>>;
  setSpot(contactId: string, label: string): Promise<void>;
  /** Where the customer said they are, if they said so after `since`. */
  spot(contactId: string, since: Date): Promise<string | null>;
  /** Saves the table and pickup code on a confirmed order, unless it already has a code. */
  setPickup(orderId: string, tableLabel: string | null, pickupCode: string): Promise<void>;
  order(orderId: string): Promise<PickupOrder | null>;
  /** The order with this number and 4-digit code, for staff typing it in. */
  findByCode(orderNumber: number, pickupCode: string): Promise<PickupOrder | null>;
  /** Makes the tickets for a paid order. Running it twice for one order makes nothing new. */
  createTickets(orderId: string, tickets: Array<{ station: string; items: string }>): Promise<void>;
  /** Tickets made since `since` that aren't collected, plus ones collected after `collectedSince`, oldest first. */
  tickets(since: Date, collectedSince: Date, station?: string): Promise<Ticket[]>;
  ticketsForOrder(orderId: string): Promise<Ticket[]>;
  /** Moves a ticket on. Null when it wasn't in one of `from` (e.g. already collected), so a second scan does nothing. */
  moveTicket(ticketId: string, from: TicketStatus[], to: TicketStatus): Promise<Ticket | null>;
  /** Walk-in orders confirmed since `since` and not paid yet, oldest first. */
  unpaid(since: Date): Promise<PickupOrder[]>;
}

type OrderRow = {
  id: string;
  order_number: number | string;
  status: PickupOrder["status"];
  total_kobo: number | string;
  table_label: string | null;
  pickup_code: string | null;
  created_at: string;
  contacts: { wa_id: string; name: string | null };
  quote_order_items: Array<{ name: string; quantity: number }>;
};

const ORDER_COLUMNS =
  "id, order_number, status, total_kobo, table_label, pickup_code, created_at, contacts(wa_id, name), quote_order_items(name, quantity)";

export function itemsText(lines: Array<{ name: string; quantity: number }>): string {
  return lines.map((l) => `${l.quantity} x ${l.name}`).join(", ");
}

function toOrder(r: OrderRow): PickupOrder {
  return {
    id: r.id,
    orderNumber: Number(r.order_number),
    status: r.status,
    totalKobo: Number(r.total_kobo),
    items: itemsText(r.quote_order_items),
    tableLabel: r.table_label,
    pickupCode: r.pickup_code,
    customerName: r.contacts.name,
    customerWaId: r.contacts.wa_id,
    createdAt: new Date(r.created_at),
  };
}

type TicketRow = {
  id: string;
  order_id: string;
  station: string;
  items: string;
  status: TicketStatus;
  created_at: string;
  ready_at: string | null;
  collected_at: string | null;
  quote_orders: { order_number: number | string; table_label: string | null; contacts: { wa_id: string; name: string | null } };
};

const TICKET_COLUMNS =
  "id, order_id, station, items, status, created_at, ready_at, collected_at, quote_orders!inner(order_number, table_label, contacts(wa_id, name))";

function toTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    orderId: r.order_id,
    orderNumber: Number(r.quote_orders.order_number),
    station: r.station,
    items: r.items,
    status: r.status,
    tableLabel: r.quote_orders.table_label,
    customerName: r.quote_orders.contacts.name,
    customerWaId: r.quote_orders.contacts.wa_id,
    createdAt: new Date(r.created_at),
    readyAt: r.ready_at ? new Date(r.ready_at) : null,
    collectedAt: r.collected_at ? new Date(r.collected_at) : null,
  };
}

export function createSupabaseWalkInStore(db: SupabaseClient, businessId: string): WalkInStore {
  const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);
  const one = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
    const { data, error } = await query;
    if (error) throw fail(what, error);
    return data ? toOrder(data as OrderRow) : null;
  };

  return {
    async settings() {
      const { data, error } = await db.from("quote_businesses").select("walk_in, orders_paused").eq("id", businessId).maybeSingle();
      if (error) throw fail("walk-in settings", error);
      return { walkIn: Boolean(data?.walk_in), paused: Boolean(data?.orders_paused) };
    },

    async setSettings(change) {
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (change.walkIn !== undefined) update.walk_in = change.walkIn;
      if (change.paused !== undefined) update.orders_paused = change.paused;
      const { error } = await db.from("quote_businesses").update(update).eq("id", businessId);
      if (error) throw fail("walk-in setSettings", error);
    },

    async products() {
      const { data, error } = await db
        .from("quote_products")
        .select("id, name, station")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("name");
      if (error) throw fail("walk-in products", error);
      return (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, station: (p.station as string | null) ?? null }));
    },

    async setStation(productId, station) {
      const { error } = await db
        .from("quote_products")
        .update({ station, updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("business_id", businessId);
      if (error) throw fail("setStation", error);
    },

    async stationsOf(variantIds) {
      if (!variantIds.length) return new Map();
      const { data, error } = await db.from("quote_variants").select("id, quote_products!inner(station)").in("id", variantIds);
      if (error) throw fail("stationsOf", error);
      return new Map(
        (data ?? []).map((v) => [v.id as string, (v.quote_products as unknown as { station: string | null }).station ?? null]),
      );
    },

    async setSpot(contactId, label) {
      const { error } = await db
        .from("quote_walk_in_spots")
        .upsert({ business_id: businessId, contact_id: contactId, label, set_at: new Date().toISOString() });
      if (error) throw fail("setSpot", error);
    },

    async spot(contactId, since) {
      const { data, error } = await db
        .from("quote_walk_in_spots")
        .select("label")
        .eq("business_id", businessId)
        .eq("contact_id", contactId)
        .gte("set_at", since.toISOString())
        .maybeSingle();
      if (error) throw fail("spot", error);
      return (data?.label as string | undefined) ?? null;
    },

    async setPickup(orderId, tableLabel, pickupCode) {
      const { error } = await db
        .from("quote_orders")
        .update({ table_label: tableLabel, pickup_code: pickupCode })
        .eq("id", orderId)
        .eq("business_id", businessId)
        .is("pickup_code", null);
      if (error) throw fail("setPickup", error);
    },

    order: (orderId) =>
      one(db.from("quote_orders").select(ORDER_COLUMNS).eq("business_id", businessId).eq("id", orderId).maybeSingle(), "walk-in order"),

    findByCode: (orderNumber, pickupCode) =>
      one(
        db
          .from("quote_orders")
          .select(ORDER_COLUMNS)
          .eq("business_id", businessId)
          .eq("order_number", orderNumber)
          .eq("pickup_code", pickupCode)
          .maybeSingle(),
        "findByCode",
      ),

    async createTickets(orderId, tickets) {
      if (!tickets.length) return;
      const { error } = await db
        .from("quote_order_tickets")
        .upsert(
          tickets.map((t) => ({ business_id: businessId, order_id: orderId, station: t.station, items: t.items })),
          { onConflict: "order_id,station", ignoreDuplicates: true },
        );
      if (error) throw fail("createTickets", error);
    },

    async tickets(since, collectedSince, station) {
      let query = db
        .from("quote_order_tickets")
        .select(TICKET_COLUMNS)
        .eq("business_id", businessId)
        .gte("created_at", since.toISOString())
        .or(`status.neq.collected,collected_at.gte.${collectedSince.toISOString()}`)
        .order("created_at")
        .limit(300);
      if (station) query = query.eq("station", station);
      const { data, error } = await query;
      if (error) throw fail("tickets", error);
      return ((data ?? []) as unknown as TicketRow[]).map(toTicket);
    },

    async ticketsForOrder(orderId) {
      const { data, error } = await db
        .from("quote_order_tickets")
        .select(TICKET_COLUMNS)
        .eq("business_id", businessId)
        .eq("order_id", orderId)
        .order("station");
      if (error) throw fail("ticketsForOrder", error);
      return ((data ?? []) as unknown as TicketRow[]).map(toTicket);
    },

    async moveTicket(ticketId, from, to) {
      const at = new Date().toISOString();
      const { data, error } = await db
        .from("quote_order_tickets")
        .update({ status: to, ...(to === "ready" ? { ready_at: at } : { collected_at: at }) })
        .eq("id", ticketId)
        .eq("business_id", businessId)
        .in("status", from)
        .select(TICKET_COLUMNS);
      if (error) throw fail("moveTicket", error);
      const row = (data ?? [])[0] as unknown as TicketRow | undefined;
      return row ? toTicket(row) : null;
    },

    async unpaid(since) {
      const { data, error } = await db
        .from("quote_orders")
        .select(ORDER_COLUMNS)
        .eq("business_id", businessId)
        .eq("status", "confirmed")
        .not("pickup_code", "is", null)
        .gte("confirmed_at", since.toISOString())
        .order("confirmed_at")
        .limit(100);
      if (error) throw fail("unpaid", error);
      return ((data ?? []) as unknown as OrderRow[]).map(toOrder);
    },
  };
}
