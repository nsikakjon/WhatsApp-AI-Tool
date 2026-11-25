import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, Busy, Calendar, ClassTime } from "./slots.js";

// Appointment booking in the database (migration 0099).

export type Payment = "full" | "deposit" | "later";

export interface BookingService {
  variantId: string;
  minutes: number;
  /** 1: one-to-one. More: a group class with this many places. */
  places: number;
  payment: Payment;
  /** What a deposit booking pays up front, in kobo. */
  depositKobo: number;
}

export interface BookingRules {
  noticeHours: number;
  daysAhead: number;
  /** Customers can cancel or change a booking up to this many hours before. */
  cancelHours: number;
}

export type AppointmentStatus = "held" | "booked" | "cancelled" | "done" | "no_show";

export interface Appointment {
  id: string;
  /** Shown as B1042. */
  number: number;
  variantId: string;
  calendarId: string | null;
  contactId: string | null;
  customerWaId: string;
  customerName: string | null;
  start: Date;
  end: Date;
  places: number;
  status: AppointmentStatus;
  heldUntil: Date | null;
  orderId: string | null;
  priceKobo: number;
  payNowKobo: number;
}

export interface PlaceInput {
  variantId: string;
  calendarId: string | null;
  start: Date;
  end: Date;
  waId: string;
  name: string | null;
  contactId: string | null;
  places: number;
  /** held: waits for payment for holdMinutes. booked: confirmed now. */
  status: "held" | "booked";
  holdMinutes: number;
  priceKobo: number;
  payNowKobo: number;
  /** Moves this booking to the new time instead of making a new one. */
  move?: string | null;
}

export interface AppointmentStore {
  /** The services customers can book, by variant id. */
  services(): Promise<Map<string, BookingService>>;
  saveService(service: BookingService): Promise<void>;
  removeService(variantId: string): Promise<void>;
  /** Active calendars with their hours, oldest first (the order "first free" tries them in). */
  calendars(): Promise<Calendar[]>;
  addCalendar(name: string): Promise<Calendar>;
  removeCalendar(id: string): Promise<void>;
  /** Sets these weekdays' hours, or clears them (a day off) with null. */
  setHours(calendarId: string, weekdays: number[], hours: { start: number; end: number } | null): Promise<void>;
  setCalendarServices(calendarId: string, variantIds: string[]): Promise<void>;
  /** Every group class's weekly times (minutes filled in from its service). */
  classTimes(): Promise<ClassTime[]>;
  setClassTimes(variantId: string, calendarId: string | null, weekdays: number[], startMinute: number): Promise<void>;
  clearClassTimes(variantId: string): Promise<void>;
  /** Blocks that haven't ended by `from`. */
  blocks(from: Date): Promise<Block[]>;
  addBlock(calendarId: string | null, start: Date, end: Date): Promise<void>;
  /** Booked, and held-and-unpaid, bookings that overlap from..to. */
  busy(from: Date, to: Date): Promise<Busy[]>;
  rules(): Promise<BookingRules>;
  setRules(rules: Partial<BookingRules>): Promise<void>;
  /** Books (or moves) a time. Null when it was taken first. */
  place(input: PlaceInput): Promise<string | null>;
  byId(id: string): Promise<Appointment | null>;
  byNumber(number: number): Promise<Appointment | null>;
  /** This customer's held and booked bookings that haven't started by `from`, soonest first. */
  upcomingFor(waId: string, from: Date): Promise<Appointment[]>;
  /** Every booking (any status but cancelled) starting from..to, soonest first. */
  between(from: Date, to: Date): Promise<Appointment[]>;
  setOrder(id: string, orderId: string): Promise<void>;
  forOrder(orderId: string): Promise<Appointment[]>;
  /**
   * Held to booked, once paid. `unpaid`: booked without paying online (no pay
   * link), so nothing counts as paid. False when it wasn't held.
   */
  book(id: string, unpaid?: boolean): Promise<boolean>;
  /** False when it was already in that state, or cancelled. */
  setStatus(id: string, status: "cancelled" | "done" | "no_show"): Promise<boolean>;
  /** Cancels an order that hasn't been paid, so nobody chases payment for a booking that's gone. */
  cancelUnpaidOrder(orderId: string): Promise<void>;
  /** Held bookings whose time to pay ran out before `now`. */
  expiredHolds(now: Date): Promise<Appointment[]>;
  /** Records a reminder, once. False when it was already sent. */
  claimReminder(id: string, kind: "day" | "soon"): Promise<boolean>;
  /** Booked bookings starting from..to that haven't had this reminder. */
  needReminder(kind: "day" | "soon", from: Date, to: Date): Promise<Appointment[]>;
  /** Records today's morning summary, once. False when it already went. */
  claimSummary(day: string): Promise<boolean>;
}

interface AppointmentRow {
  id: string;
  number: number;
  variant_id: string;
  calendar_id: string | null;
  contact_id: string | null;
  customer_wa_id: string;
  customer_name: string | null;
  starts_at: string;
  ends_at: string;
  places: number;
  status: AppointmentStatus;
  held_until: string | null;
  order_id: string | null;
  price_kobo: number;
  pay_now_kobo: number;
}

const COLUMNS = "id, number, variant_id, calendar_id, contact_id, customer_wa_id, customer_name, starts_at, ends_at, places, status, held_until, order_id, price_kobo, pay_now_kobo";

function toAppointment(r: AppointmentRow): Appointment {
  return {
    id: r.id,
    number: Number(r.number),
    variantId: r.variant_id,
    calendarId: r.calendar_id,
    contactId: r.contact_id,
    customerWaId: r.customer_wa_id,
    customerName: r.customer_name,
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
    places: r.places,
    status: r.status,
    heldUntil: r.held_until ? new Date(r.held_until) : null,
    orderId: r.order_id,
    priceKobo: Number(r.price_kobo),
    payNowKobo: Number(r.pay_now_kobo),
  };
}

export function createSupabaseAppointmentStore(db: SupabaseClient, businessId: string): AppointmentStore {
  const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);
  const appointments = () => db.from("quote_appointments").select(COLUMNS).eq("business_id", businessId);

  async function many(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Appointment[]> {
    const { data, error } = await query;
    if (error) throw fail(what, error);
    return ((data ?? []) as AppointmentRow[]).map(toAppointment);
  }

  return {
    async services() {
      const { data, error } = await db.from("quote_booking_services").select("variant_id, minutes, places, payment, deposit_kobo").eq("business_id", businessId);
      if (error) throw fail("services", error);
      return new Map(
        (data ?? []).map((r) => [
          r.variant_id as string,
          { variantId: r.variant_id, minutes: r.minutes, places: r.places, payment: r.payment as Payment, depositKobo: Number(r.deposit_kobo) },
        ]),
      );
    },

    async saveService(s) {
      const { error } = await db.from("quote_booking_services").upsert({
        variant_id: s.variantId,
        business_id: businessId,
        minutes: s.minutes,
        places: s.places,
        payment: s.payment,
        deposit_kobo: s.depositKobo,
        updated_at: new Date().toISOString(),
      });
      if (error) throw fail("saveService", error);
    },

    async removeService(variantId) {
      const { error } = await db.from("quote_booking_services").delete().eq("business_id", businessId).eq("variant_id", variantId);
      if (error) throw fail("removeService", error);
    },

    async calendars() {
      const { data, error } = await db
        .from("quote_booking_calendars")
        .select("id, name, services, quote_booking_hours(weekday, start_minute, end_minute)")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("created_at");
      if (error) throw fail("calendars", error);
      return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        services: (r.services as string[] | null) ?? [],
        hours: new Map(
          ((r.quote_booking_hours ?? []) as Array<{ weekday: number; start_minute: number; end_minute: number }>).map((h) => [h.weekday, { start: h.start_minute, end: h.end_minute }]),
        ),
      }));
    },

    async addCalendar(name) {
      const { data, error } = await db.from("quote_booking_calendars").insert({ business_id: businessId, name }).select("id, name").single();
      if (error) throw fail("addCalendar", error);
      return { id: data.id, name: data.name, services: [], hours: new Map() };
    },

    async removeCalendar(id) {
      const { error } = await db.from("quote_booking_calendars").update({ active: false }).eq("business_id", businessId).eq("id", id);
      if (error) throw fail("removeCalendar", error);
    },

    async setHours(calendarId, weekdays, hours) {
      const del = await db.from("quote_booking_hours").delete().eq("calendar_id", calendarId).in("weekday", weekdays);
      if (del.error) throw fail("setHours", del.error);
      if (!hours) return;
      const { error } = await db
        .from("quote_booking_hours")
        .insert(weekdays.map((weekday) => ({ calendar_id: calendarId, weekday, start_minute: hours.start, end_minute: hours.end })));
      if (error) throw fail("setHours", error);
    },

    async setCalendarServices(calendarId, variantIds) {
      const { error } = await db.from("quote_booking_calendars").update({ services: variantIds }).eq("business_id", businessId).eq("id", calendarId);
      if (error) throw fail("setCalendarServices", error);
    },

    async classTimes() {
      const { data, error } = await db
        .from("quote_booking_class_times")
        .select("variant_id, calendar_id, weekday, start_minute, quote_booking_services(minutes)")
        .eq("business_id", businessId);
      if (error) throw fail("classTimes", error);
      return (data ?? []).map((r) => {
        const service = r.quote_booking_services as unknown as { minutes: number } | null;
        return { variantId: r.variant_id, calendarId: r.calendar_id, weekday: r.weekday, startMinute: r.start_minute, minutes: service?.minutes ?? 60 };
      });
    },

    async setClassTimes(variantId, calendarId, weekdays, startMinute) {
      const { error } = await db.from("quote_booking_class_times").upsert(
        weekdays.map((weekday) => ({ business_id: businessId, variant_id: variantId, calendar_id: calendarId, weekday, start_minute: startMinute })),
        { onConflict: "variant_id,weekday,start_minute" },
      );
      if (error) throw fail("setClassTimes", error);
    },

    async clearClassTimes(variantId) {
      const { error } = await db.from("quote_booking_class_times").delete().eq("business_id", businessId).eq("variant_id", variantId);
      if (error) throw fail("clearClassTimes", error);
    },

    async blocks(from) {
      const { data, error } = await db.from("quote_booking_blocks").select("calendar_id, starts_at, ends_at").eq("business_id", businessId).gt("ends_at", from.toISOString());
      if (error) throw fail("blocks", error);
      return (data ?? []).map((r) => ({ calendarId: r.calendar_id, start: new Date(r.starts_at), end: new Date(r.ends_at) }));
    },

    async addBlock(calendarId, start, end) {
      const { error } = await db
        .from("quote_booking_blocks")
        .insert({ business_id: businessId, calendar_id: calendarId, starts_at: start.toISOString(), ends_at: end.toISOString() });
      if (error) throw fail("addBlock", error);
    },

    async busy(from, to) {
      const { data, error } = await db
        .from("quote_appointments")
        .select("variant_id, calendar_id, starts_at, ends_at, places, status, held_until")
        .eq("business_id", businessId)
        .in("status", ["booked", "held"])
        .lt("starts_at", to.toISOString())
        .gt("ends_at", from.toISOString());
      if (error) throw fail("busy", error);
      const now = Date.now();
      return (data ?? [])
        .filter((r) => r.status === "booked" || (r.held_until && Date.parse(r.held_until) > now))
        .map((r) => ({ variantId: r.variant_id, calendarId: r.calendar_id, start: new Date(r.starts_at), end: new Date(r.ends_at), places: r.places }));
    },

    async rules() {
      const { data, error } = await db
        .from("quote_businesses")
        .select("booking_notice_hours, booking_days_ahead, booking_cancel_hours")
        .eq("id", businessId)
        .maybeSingle();
      if (error) throw fail("rules", error);
      return {
        noticeHours: data?.booking_notice_hours ?? 2,
        daysAhead: data?.booking_days_ahead ?? 14,
        cancelHours: data?.booking_cancel_hours ?? 12,
      };
    },

    async setRules(rules) {
      const update: Record<string, number> = {};
      if (rules.noticeHours !== undefined) update.booking_notice_hours = rules.noticeHours;
      if (rules.daysAhead !== undefined) update.booking_days_ahead = rules.daysAhead;
      if (rules.cancelHours !== undefined) update.booking_cancel_hours = rules.cancelHours;
      const { error } = await db.from("quote_businesses").update(update).eq("id", businessId);
      if (error) throw fail("setRules", error);
    },

    async place(p) {
      const { data, error } = await db.rpc("quote_appointment_place", {
        p_business: businessId,
        p_variant: p.variantId,
        p_calendar: p.calendarId,
        p_start: p.start.toISOString(),
        p_end: p.end.toISOString(),
        p_wa_id: p.waId,
        p_name: p.name,
        p_contact: p.contactId,
        p_places: p.places,
        p_status: p.status,
        p_hold_minutes: p.holdMinutes,
        p_price_kobo: p.priceKobo,
        p_pay_now_kobo: p.payNowKobo,
        p_move: p.move ?? null,
      });
      if (error) throw fail("place", error);
      return (data as string | null) ?? null;
    },

    async byId(id) {
      return (await many(appointments().eq("id", id), "byId"))[0] ?? null;
    },

    async byNumber(number) {
      return (await many(appointments().eq("number", number), "byNumber"))[0] ?? null;
    },

    upcomingFor(waId, from) {
      return many(
        appointments().eq("customer_wa_id", waId).in("status", ["held", "booked"]).gt("starts_at", from.toISOString()).order("starts_at").limit(10),
        "upcomingFor",
      );
    },

    between(from, to) {
      return many(
        appointments().neq("status", "cancelled").gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at").limit(200),
        "between",
      );
    },

    async setOrder(id, orderId) {
      const { error } = await db.from("quote_appointments").update({ order_id: orderId }).eq("business_id", businessId).eq("id", id);
      if (error) throw fail("setOrder", error);
    },

    forOrder(orderId) {
      return many(appointments().eq("order_id", orderId), "forOrder");
    },

    async book(id, unpaid) {
      const { data, error } = await db
        .from("quote_appointments")
        .update({ status: "booked", held_until: null, updated_at: new Date().toISOString(), ...(unpaid ? { pay_now_kobo: 0 } : {}) })
        .eq("business_id", businessId)
        .eq("id", id)
        .eq("status", "held")
        .select("id");
      if (error) throw fail("book", error);
      return (data ?? []).length > 0;
    },

    async setStatus(id, status) {
      const from = status === "cancelled" ? ["held", "booked"] : ["booked", "done", "no_show"];
      const { data, error } = await db
        .from("quote_appointments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("business_id", businessId)
        .eq("id", id)
        .in("status", from.filter((s) => s !== status))
        .select("id");
      if (error) throw fail("setStatus", error);
      return (data ?? []).length > 0;
    },

    async cancelUnpaidOrder(orderId) {
      const { error } = await db
        .from("quote_orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("business_id", businessId)
        .eq("id", orderId)
        .in("status", ["quoted", "confirmed"]);
      if (error) throw fail("cancelUnpaidOrder", error);
    },

    expiredHolds(now) {
      return many(appointments().eq("status", "held").lt("held_until", now.toISOString()).limit(100), "expiredHolds");
    },

    async claimReminder(id, kind) {
      const column = kind === "day" ? "day_reminded_at" : "soon_reminded_at";
      const { data, error } = await db
        .from("quote_appointments")
        .update({ [column]: new Date().toISOString() })
        .eq("business_id", businessId)
        .eq("id", id)
        .is(column, null)
        .select("id");
      if (error) throw fail("claimReminder", error);
      return (data ?? []).length > 0;
    },

    needReminder(kind, from, to) {
      const column = kind === "day" ? "day_reminded_at" : "soon_reminded_at";
      return many(
        appointments().eq("status", "booked").is(column, null).gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).limit(200),
        "needReminder",
      );
    },

    async claimSummary(day) {
      const { data, error } = await db
        .from("quote_businesses")
        .update({ booking_summary_sent_on: day })
        .eq("id", businessId)
        .or(`booking_summary_sent_on.is.null,booking_summary_sent_on.lt.${day}`)
        .select("id");
      if (error) throw fail("claimSummary", error);
      return (data ?? []).length > 0;
    },
  };
}
