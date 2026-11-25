import { randomUUID } from "node:crypto";
import type { Block, Calendar, ClassTime } from "./slots.js";
import type { Appointment, AppointmentStore, BookingRules, BookingService } from "./store.js";

/** An in-memory AppointmentStore for tests, with the same rules as quote_appointment_place. */
export function createMemoryAppointmentStore(clock: () => Date = () => new Date()) {
  const services = new Map<string, BookingService>();
  const calendars: Array<Calendar & { active: boolean }> = [];
  const classTimes: ClassTime[] = [];
  const blocks: Block[] = [];
  const appointments: Appointment[] = [];
  const reminded = new Set<string>();
  const cancelledOrders = new Set<string>();
  let rules: BookingRules = { noticeHours: 2, daysAhead: 14, cancelHours: 12 };
  let summaryDay: string | null = null;
  let next = 1000;

  const live = (a: Appointment) => a.status === "booked" || (a.status === "held" && !!a.heldUntil && a.heldUntil > clock());
  const copy = (a: Appointment) => ({ ...a });

  const store: AppointmentStore = {
    services: async () => new Map([...services].map(([k, v]) => [k, { ...v }])),
    saveService: async (s) => void services.set(s.variantId, { ...s }),
    removeService: async (id) => void services.delete(id),
    calendars: async () => calendars.filter((c) => c.active).map((c) => ({ ...c, hours: new Map(c.hours), services: [...c.services] })),
    async addCalendar(name) {
      const cal = { id: randomUUID(), name, services: [], hours: new Map(), active: true };
      calendars.push(cal);
      return { ...cal };
    },
    async removeCalendar(id) {
      const cal = calendars.find((c) => c.id === id);
      if (cal) cal.active = false;
    },
    async setHours(id, weekdays, hours) {
      const cal = calendars.find((c) => c.id === id)!;
      for (const d of weekdays) hours ? cal.hours.set(d, { ...hours }) : cal.hours.delete(d);
    },
    async setCalendarServices(id, variantIds) {
      calendars.find((c) => c.id === id)!.services = [...variantIds];
    },
    classTimes: async () => classTimes.map((c) => ({ ...c, minutes: services.get(c.variantId)?.minutes ?? 60 })),
    async setClassTimes(variantId, calendarId, weekdays, startMinute) {
      for (const weekday of weekdays) {
        if (classTimes.some((c) => c.variantId === variantId && c.weekday === weekday && c.startMinute === startMinute)) continue;
        classTimes.push({ variantId, calendarId, weekday, startMinute, minutes: 0 });
      }
    },
    async clearClassTimes(variantId) {
      for (let i = classTimes.length - 1; i >= 0; i--) if (classTimes[i]!.variantId === variantId) classTimes.splice(i, 1);
    },
    blocks: async (from) => blocks.filter((b) => b.end > from),
    addBlock: async (calendarId, start, end) => void blocks.push({ calendarId, start, end }),
    busy: async (from, to) =>
      appointments.filter((a) => live(a) && a.start < to && a.end > from).map((a) => ({ variantId: a.variantId, calendarId: a.calendarId, start: a.start, end: a.end, places: a.places })),
    rules: async () => ({ ...rules }),
    setRules: async (r) => void (rules = { ...rules, ...r }),
    async place(p) {
      const service = services.get(p.variantId);
      if (!service) return null;
      const others = appointments.filter((a) => live(a) && a.id !== p.move);
      if (service.places > 1) {
        const taken = others.filter((a) => a.variantId === p.variantId && a.start.getTime() === p.start.getTime()).reduce((n, a) => n + a.places, 0);
        if (taken + p.places > service.places) return null;
      } else {
        if (!p.calendarId || !calendars.some((c) => c.id === p.calendarId && c.active)) return null;
        if (others.some((a) => a.calendarId === p.calendarId && a.start < p.end && a.end > p.start)) return null;
      }
      if (p.move) {
        const a = appointments.find((x) => x.id === p.move && (x.status === "held" || x.status === "booked"));
        if (!a) return null;
        Object.assign(a, { start: p.start, end: p.end, calendarId: p.calendarId });
        reminded.delete(`${a.id} day`);
        reminded.delete(`${a.id} soon`);
        return a.id;
      }
      const a: Appointment = {
        id: randomUUID(),
        number: next++,
        variantId: p.variantId,
        calendarId: p.calendarId,
        contactId: p.contactId,
        customerWaId: p.waId,
        customerName: p.name,
        start: p.start,
        end: p.end,
        places: p.places,
        status: p.status,
        heldUntil: p.status === "held" ? new Date(clock().getTime() + p.holdMinutes * 60_000) : null,
        orderId: null,
        priceKobo: p.priceKobo,
        payNowKobo: p.payNowKobo,
      };
      appointments.push(a);
      return a.id;
    },
    byId: async (id) => (appointments.find((a) => a.id === id) ? copy(appointments.find((a) => a.id === id)!) : null),
    byNumber: async (n) => (appointments.find((a) => a.number === n) ? copy(appointments.find((a) => a.number === n)!) : null),
    upcomingFor: async (waId, from) =>
      appointments.filter((a) => a.customerWaId === waId && (a.status === "held" || a.status === "booked") && a.start > from).sort((x, y) => +x.start - +y.start).map(copy),
    between: async (from, to) => appointments.filter((a) => a.status !== "cancelled" && a.start >= from && a.start < to).sort((x, y) => +x.start - +y.start).map(copy),
    async setOrder(id, orderId) {
      appointments.find((a) => a.id === id)!.orderId = orderId;
    },
    forOrder: async (orderId) => appointments.filter((a) => a.orderId === orderId).map(copy),
    async book(id, unpaid) {
      const a = appointments.find((x) => x.id === id);
      if (!a || a.status !== "held") return false;
      a.status = "booked";
      a.heldUntil = null;
      if (unpaid) a.payNowKobo = 0;
      return true;
    },
    async setStatus(id, status) {
      const a = appointments.find((x) => x.id === id);
      const from = status === "cancelled" ? ["held", "booked"] : ["booked", "done", "no_show"];
      if (!a || a.status === status || !from.includes(a.status)) return false;
      a.status = status;
      return true;
    },
    cancelUnpaidOrder: async (orderId) => void cancelledOrders.add(orderId),
    expiredHolds: async (now) => appointments.filter((a) => a.status === "held" && a.heldUntil! < now).map(copy),
    async claimReminder(id, kind) {
      if (reminded.has(`${id} ${kind}`)) return false;
      reminded.add(`${id} ${kind}`);
      return true;
    },
    needReminder: async (kind, from, to) =>
      appointments.filter((a) => a.status === "booked" && !reminded.has(`${a.id} ${kind}`) && a.start >= from && a.start < to).map(copy),
    async claimSummary(day) {
      if (summaryDay && summaryDay >= day) return false;
      summaryDay = day;
      return true;
    },
  };
  return { store, appointments, cancelledOrders };
}
