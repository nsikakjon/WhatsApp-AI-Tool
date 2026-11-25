import { addDays, lagosToday, type Day } from "./dates.js";
import type { Booking, BookingStatus, HireItem, NewBooking, RentalStore } from "./store.js";

// An in-memory hire store for tests, following the database's rules
// (migration 0097): only held (not expired), booked and out bookings take
// units, and something out after its return date stays taken.

export interface MemoryRentals extends RentalStore {
  bookings: Booking[];
  hireItems: Map<string, HireItem>;
  summaries: Set<Day>;
  /** Orders customers have paid, for money in. */
  paid: Array<{ at: Date; kobo: number }>;
}

export function memoryRentals(opts: {
  now: () => Date;
  names: Record<string, string>;
  orders: Record<string, { number: number; contactId: string; waId: string; name: string | null }>;
}): MemoryRentals {
  const store: MemoryRentals = {
    bookings: [],
    hireItems: new Map(),
    summaries: new Set(),
    paid: [],

    async items(ids) {
      return new Map([...store.hireItems].filter(([id]) => !ids || ids.includes(id)));
    },
    async setItem(variantId, change) {
      const item = { ...(store.hireItems.get(variantId) ?? { variantId, units: 1, weeklyKobo: null, depositKobo: 0 }), ...change };
      store.hireItems.set(variantId, item);
      return item;
    },
    async removeItem(variantId) {
      store.hireItems.delete(variantId);
    },
    async taken(variantId, start, back, except) {
      const today = lagosToday(opts.now());
      let most = 0;
      for (let d = start; d < back; d = addDays(d, 1)) {
        let units = 0;
        for (const b of store.bookings) {
          if (b.variantId !== variantId || b.orderId === except) continue;
          const counts = b.status === "booked" || b.status === "out" || (b.status === "held" && (b.heldUntil?.getTime() ?? 0) > opts.now().getTime());
          const end = b.status === "out" && b.back <= today ? addDays(today, 1) : b.back;
          if (counts && b.start <= d && end > d) units += b.units;
        }
        most = Math.max(most, units);
      }
      return most;
    },
    async saveQuote(orderId, list: NewBooking[]) {
      const order = opts.orders[orderId]!;
      for (const b of list) {
        store.bookings.push({
          ...b,
          id: `${orderId}-${b.variantId}`,
          orderId,
          orderNumber: order.number,
          name: opts.names[b.variantId] ?? b.variantId,
          status: "quoted",
          heldUntil: null,
          outAt: null,
          contactId: order.contactId,
          customerWaId: order.waId,
          customerName: order.name,
          orderStatus: "quoted",
          startRemindedAt: null,
          returnRemindedAt: null,
          overdueRemindedAt: null,
        });
      }
    },
    async forOrder(orderId) {
      return store.bookings.filter((b) => b.orderId === orderId);
    },
    async hold(orderId, hours) {
      const mine = store.bookings.filter((b) => b.orderId === orderId && (b.status === "quoted" || b.status === "held"));
      for (const b of mine) {
        const owned = store.hireItems.get(b.variantId)?.units ?? 0;
        const taken = await store.taken(b.variantId, b.start, b.back, orderId);
        if (taken + b.units > owned) return { ok: false, variantId: b.variantId, free: Math.max(owned - taken, 0) };
      }
      for (const b of mine) {
        b.status = "held";
        b.heldUntil = new Date(opts.now().getTime() + hours * 3_600_000);
      }
      return { ok: true };
    },
    async move(orderId, from: BookingStatus[], to) {
      const moved = store.bookings.filter((b) => b.orderId === orderId && from.includes(b.status));
      for (const b of moved) {
        b.status = to;
        if (to === "out") b.outAt = opts.now();
      }
      return moved;
    },
    async returned(id) {
      const b = store.bookings.find((x) => x.id === id);
      if (!b || b.status === "returned") return false;
      b.status = "returned";
      return true;
    },
    async active() {
      return store.bookings.filter((b) => b.status === "booked" || b.status === "out" || (b.status === "held" && (b.heldUntil?.getTime() ?? 0) > opts.now().getTime()));
    },
    async claimReminder(id, kind) {
      const b = store.bookings.find((x) => x.id === id)!;
      const key = `${kind}RemindedAt` as const;
      if (b[key]) return false;
      b[key] = opts.now();
      return true;
    },
    async claimSummary(day) {
      if (store.summaries.has(day)) return false;
      store.summaries.add(day);
      return true;
    },
    async paidBetween(from, to) {
      const list = store.paid.filter((p) => p.at >= from && p.at < to);
      return { kobo: list.reduce((s, p) => s + p.kobo, 0), orders: list.length };
    },
  };
  return store;
}
