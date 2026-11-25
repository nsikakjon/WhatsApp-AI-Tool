import type { SupabaseClient } from "@supabase/supabase-js";
import type { Day } from "./dates.js";

// Hire items and bookings in the database (migration 0097).

export interface HireItem {
  variantId: string;
  /** How many of it the business has to hire out. */
  units: number;
  weeklyKobo: number | null;
  /** Refundable deposit for one unit. */
  depositKobo: number;
}

export type BookingStatus = "quoted" | "held" | "booked" | "out" | "returned" | "cancelled";

export interface NewBooking {
  variantId: string;
  units: number;
  start: Day;
  back: Day;
  dailyKobo: number;
  weeklyKobo: number | null;
  /** For one unit. */
  depositKobo: number;
}

export interface Booking extends NewBooking {
  id: string;
  orderId: string;
  orderNumber: number;
  /** The price list name, e.g. "Generator: 20kVA". */
  name: string;
  status: BookingStatus;
  heldUntil: Date | null;
  outAt: Date | null;
  contactId: string;
  customerWaId: string;
  customerName: string | null;
  orderStatus: string;
  startRemindedAt: Date | null;
  returnRemindedAt: Date | null;
  overdueRemindedAt: Date | null;
}

export type Reminder = "start" | "return" | "overdue";

export interface RentalStore {
  /** The hire settings of these price list rows (all hire items when left out). */
  items(variantIds?: string[]): Promise<Map<string, HireItem>>;
  /** Makes a row a hire item, or changes its settings. */
  setItem(variantId: string, change: Partial<Omit<HireItem, "variantId">>): Promise<HireItem>;
  removeItem(variantId: string): Promise<void>;
  /** The most units of an item taken on any one day from `start` up to `back`, leaving out one order. */
  taken(variantId: string, start: Day, back: Day, exceptOrderId: string | null): Promise<number>;
  saveQuote(orderId: string, bookings: NewBooking[]): Promise<void>;
  forOrder(orderId: string): Promise<Booking[]>;
  /** Holds an order's items for its customer while they pay; says which item ran out if one did. */
  hold(orderId: string, hours: number): Promise<{ ok: true } | { ok: false; variantId: string; free: number }>;
  /** Moves an order's bookings that are in one of `from` to `to`. Returns the ones moved. */
  move(orderId: string, from: BookingStatus[], to: BookingStatus): Promise<Booking[]>;
  /** Saves the returns check on one booking. False when it was already returned. */
  returned(bookingId: string, check: { lateKobo: number; damageKobo: number; notes: string | null }): Promise<boolean>;
  /** Bookings that are held (not expired), booked or out. */
  active(): Promise<Booking[]>;
  /** Records a reminder as sent. False when it was sent already, so a reminder never goes twice. */
  claimReminder(bookingId: string, kind: Reminder): Promise<boolean>;
  /** Records today's owner summary as sent. False when it went already. */
  claimSummary(day: Day): Promise<boolean>;
  /** Money paid between two times for orders with something on hire, in kobo, and how many orders. */
  paidBetween(from: Date, to: Date): Promise<{ kobo: number; orders: number }>;
}

type Row = {
  id: string;
  order_id: string;
  variant_id: string;
  units: number;
  start_date: string;
  return_date: string;
  daily_rate_kobo: number | string;
  weekly_rate_kobo: number | string | null;
  deposit_kobo: number | string;
  status: BookingStatus;
  held_until: string | null;
  out_at: string | null;
  start_reminded_at: string | null;
  return_reminded_at: string | null;
  overdue_reminded_at: string | null;
  quote_variants: { name: string; quote_products: { name: string } };
  quote_orders: { order_number: number | string; status: string; contact_id: string; contacts: { wa_id: string; name: string | null } };
};

const COLUMNS =
  "id, order_id, variant_id, units, start_date, return_date, daily_rate_kobo, weekly_rate_kobo, deposit_kobo, status, held_until, out_at, start_reminded_at, return_reminded_at, overdue_reminded_at, quote_variants!inner(name, quote_products!inner(name)), quote_orders!inner(order_number, status, contact_id, contacts(wa_id, name))";

const date = (s: string | null) => (s ? new Date(s) : null);

/** "Generator: 20kVA", or just "Generator" when the option is the default "Standard". */
export function itemName(product: string, variant: string): string {
  return !variant || /^standard$/i.test(variant) || variant === product ? product : `${product}: ${variant}`;
}

function toBooking(r: Row): Booking {
  return {
    id: r.id,
    orderId: r.order_id,
    orderNumber: Number(r.quote_orders.order_number),
    orderStatus: r.quote_orders.status,
    variantId: r.variant_id,
    name: itemName(r.quote_variants.quote_products.name, r.quote_variants.name),
    units: r.units,
    start: r.start_date,
    back: r.return_date,
    dailyKobo: Number(r.daily_rate_kobo),
    weeklyKobo: r.weekly_rate_kobo === null ? null : Number(r.weekly_rate_kobo),
    depositKobo: Number(r.deposit_kobo),
    status: r.status,
    heldUntil: date(r.held_until),
    outAt: date(r.out_at),
    contactId: r.quote_orders.contact_id,
    customerWaId: r.quote_orders.contacts.wa_id,
    customerName: r.quote_orders.contacts.name,
    startRemindedAt: date(r.start_reminded_at),
    returnRemindedAt: date(r.return_reminded_at),
    overdueRemindedAt: date(r.overdue_reminded_at),
  };
}

function toItem(r: { variant_id: string; units: number; weekly_rate_kobo: number | string | null; deposit_kobo: number | string }): HireItem {
  return {
    variantId: r.variant_id,
    units: r.units,
    weeklyKobo: r.weekly_rate_kobo === null ? null : Number(r.weekly_rate_kobo),
    depositKobo: Number(r.deposit_kobo),
  };
}

export function createSupabaseRentalStore(db: SupabaseClient, businessId: string): RentalStore {
  const fail = (what: string, error: { message: string }) => new Error(`Hire bookings: ${what} failed: ${error.message}`);
  const bookings = () => db.from("quote_rental_bookings").select(COLUMNS).eq("business_id", businessId);
  const many = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
    const { data, error } = await query;
    if (error) throw fail(what, error);
    return ((data ?? []) as Row[]).map(toBooking);
  };

  return {
    async items(variantIds) {
      let query = db.from("quote_rental_items").select("variant_id, units, weekly_rate_kobo, deposit_kobo").eq("business_id", businessId);
      if (variantIds) {
        if (!variantIds.length) return new Map();
        query = query.in("variant_id", variantIds);
      }
      const { data, error } = await query;
      if (error) throw fail("hire items", error);
      return new Map((data ?? []).map((r) => [r.variant_id as string, toItem(r as Parameters<typeof toItem>[0])]));
    },

    async setItem(variantId, change) {
      const row: Record<string, unknown> = { variant_id: variantId, business_id: businessId, updated_at: new Date().toISOString() };
      if (change.units !== undefined) row.units = change.units;
      if (change.weeklyKobo !== undefined) row.weekly_rate_kobo = change.weeklyKobo;
      if (change.depositKobo !== undefined) row.deposit_kobo = change.depositKobo;
      const { data, error } = await db
        .from("quote_rental_items")
        .upsert(row, { onConflict: "variant_id" })
        .select("variant_id, units, weekly_rate_kobo, deposit_kobo")
        .single();
      if (error) throw fail("save hire item", error);
      return toItem(data as Parameters<typeof toItem>[0]);
    },

    async removeItem(variantId) {
      const { error } = await db.from("quote_rental_items").delete().eq("variant_id", variantId).eq("business_id", businessId);
      if (error) throw fail("remove hire item", error);
    },

    async taken(variantId, start, back, exceptOrderId) {
      const { data, error } = await db.rpc("quote_rental_taken", { p_variant_id: variantId, p_start: start, p_return: back, p_except: exceptOrderId });
      if (error) throw fail("availability", error);
      return Number(data ?? 0);
    },

    async saveQuote(orderId, list) {
      if (!list.length) return;
      const { error } = await db.from("quote_rental_bookings").insert(
        list.map((b) => ({
          business_id: businessId,
          order_id: orderId,
          variant_id: b.variantId,
          units: b.units,
          start_date: b.start,
          return_date: b.back,
          daily_rate_kobo: b.dailyKobo,
          weekly_rate_kobo: b.weeklyKobo,
          deposit_kobo: b.depositKobo,
        })),
      );
      if (error) throw fail("save booking", error);
    },

    forOrder: (orderId) => many(bookings().eq("order_id", orderId).order("start_date"), "bookings for order"),

    async hold(orderId, hours) {
      const { data, error } = await db.rpc("quote_rental_hold", { p_order_id: orderId, p_hold_hours: hours });
      if (error) throw fail("hold", error);
      const result = data as { ok: boolean; variant_id?: string; free?: number };
      return result.ok ? { ok: true } : { ok: false, variantId: result.variant_id!, free: Number(result.free ?? 0) };
    },

    async move(orderId, from, to) {
      const now = new Date().toISOString();
      const change: Record<string, unknown> = { status: to, updated_at: now };
      if (to === "out") change.out_at = now;
      const { data, error } = await db
        .from("quote_rental_bookings")
        .update(change)
        .eq("business_id", businessId)
        .eq("order_id", orderId)
        .in("status", from)
        .select(COLUMNS);
      if (error) throw fail(`move bookings to ${to}`, error);
      return ((data ?? []) as unknown as Row[]).map(toBooking);
    },

    async returned(bookingId, check) {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("quote_rental_bookings")
        .update({ status: "returned", returned_at: now, updated_at: now, late_kobo: check.lateKobo, damage_kobo: check.damageKobo, return_notes: check.notes })
        .eq("business_id", businessId)
        .eq("id", bookingId)
        .in("status", ["booked", "out", "held"])
        .select("id");
      if (error) throw fail("returns check", error);
      return (data ?? []).length > 0;
    },

    async active() {
      const list = await many(bookings().in("status", ["held", "booked", "out"]).order("start_date").limit(1000), "active bookings");
      const now = Date.now();
      return list.filter((b) => b.orderStatus !== "cancelled" && (b.status !== "held" || (b.heldUntil?.getTime() ?? 0) > now));
    },

    async claimReminder(bookingId, kind) {
      const column = `${kind}_reminded_at`;
      const { data, error } = await db
        .from("quote_rental_bookings")
        .update({ [column]: new Date().toISOString() })
        .eq("business_id", businessId)
        .eq("id", bookingId)
        .is(column, null)
        .select("id");
      if (error) throw fail("claim reminder", error);
      return (data ?? []).length > 0;
    },

    async claimSummary(day) {
      const { data, error } = await db
        .from("quote_businesses")
        .update({ hire_summary_sent_on: day })
        .eq("id", businessId)
        .or(`hire_summary_sent_on.is.null,hire_summary_sent_on.lt.${day}`)
        .select("id");
      if (error) throw fail("claim summary", error);
      return (data ?? []).length > 0;
    },

    async paidBetween(from, to) {
      const { data, error } = await db
        .from("quote_orders")
        .select("id, total_kobo, quote_rental_bookings!inner(id)")
        .eq("business_id", businessId)
        .eq("status", "paid")
        .gte("paid_at", from.toISOString())
        .lt("paid_at", to.toISOString());
      if (error) throw fail("money in", error);
      const rows = (data ?? []) as Array<{ total_kobo: number | string }>;
      return { kobo: rows.reduce((sum, r) => sum + Number(r.total_kobo), 0), orders: rows.length };
    },
  };
}
