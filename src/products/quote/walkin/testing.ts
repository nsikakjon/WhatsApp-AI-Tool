// Shared by the walk-in tests: walk-in data kept in memory, and a plan with chosen features.
import type { PlanFeature, PlanFeatures } from "../features.js";
import { createWalkInLinks } from "./links.js";
import type { PickupOrder, Ticket, TicketStatus, WalkInStore } from "./store.js";

export const BUSINESS = "00000000-0000-0000-0000-000000000002";
export const SECRET = "test-secret";
export const links = createWalkInLinks(SECRET, "https://bot.example.com");

/** Walk-in data kept in memory, shaped like the Supabase tables. */
export function memoryWalkIn() {
  const settings = { walkIn: false, paused: false };
  const products = [
    { id: "p-beer", name: "Drinks", station: null as string | null },
    { id: "p-rice", name: "Jollof rice", station: null as string | null },
    { id: "p-water", name: "Water", station: null as string | null },
  ];
  const variantProduct: Record<string, string> = { "v-beer": "p-beer", "v-rice": "p-rice", "v-water": "p-water" };
  const spots = new Map<string, { label: string; setAt: Date }>();
  const orders = new Map<string, PickupOrder>();
  const tickets: Ticket[] = [];

  const store: WalkInStore = {
    settings: async () => ({ ...settings }),
    async setSettings(change) {
      Object.assign(settings, change);
    },
    products: async () => products.map((p) => ({ ...p })),
    async setStation(productId, station) {
      products.find((p) => p.id === productId)!.station = station;
    },
    async stationsOf(ids) {
      return new Map(ids.map((id) => [id, products.find((p) => p.id === variantProduct[id])?.station ?? null]));
    },
    async setSpot(contactId, label) {
      spots.set(contactId, { label, setAt: new Date() });
    },
    async spot(contactId, since) {
      const s = spots.get(contactId);
      return s && s.setAt >= since ? s.label : null;
    },
    async setPickup(orderId, tableLabel, pickupCode) {
      const o = orders.get(orderId);
      if (o && !o.pickupCode) Object.assign(o, { tableLabel, pickupCode });
    },
    order: async (id) => orders.get(id) ?? null,
    findByCode: async (n, code) => [...orders.values()].find((o) => o.orderNumber === n && o.pickupCode === code) ?? null,
    async createTickets(orderId, list) {
      const o = orders.get(orderId)!;
      for (const t of list) {
        if (tickets.some((x) => x.orderId === orderId && x.station === t.station)) continue;
        tickets.push({
          id: `00000000-0000-0000-0000-${String(tickets.length + 1).padStart(12, "0")}`,
          orderId,
          orderNumber: o.orderNumber,
          station: t.station,
          items: t.items,
          status: "making",
          tableLabel: o.tableLabel,
          customerName: o.customerName,
          customerWaId: o.customerWaId,
          createdAt: new Date(),
          readyAt: null,
          collectedAt: null,
        });
      }
    },
    tickets: async (_since, collectedSince, station) =>
      tickets.filter((t) => (!station || t.station === station) && (t.status !== "collected" || t.collectedAt! >= collectedSince)),
    ticketsForOrder: async (orderId) => tickets.filter((t) => t.orderId === orderId),
    async moveTicket(id, from: TicketStatus[], to) {
      const t = tickets.find((x) => x.id === id);
      if (!t || !from.includes(t.status)) return null;
      t.status = to;
      if (to === "ready") t.readyAt = new Date();
      else t.collectedAt = new Date();
      return { ...t };
    },
    unpaid: async () => [...orders.values()].filter((o) => o.status === "confirmed" && o.pickupCode),
  };

  /** Adds an order as the quote bot would save it. */
  function addOrder(id: string, orderNumber: number, status: PickupOrder["status"] = "confirmed"): PickupOrder {
    const o: PickupOrder = {
      id,
      orderNumber,
      status,
      totalKobo: 900_000,
      items: "2 x Drinks: Desperados, 1 x Jollof rice: Plate",
      tableLabel: null,
      pickupCode: null,
      customerName: "Ada",
      customerWaId: "2348012345678",
      createdAt: new Date(),
    };
    orders.set(id, o);
    return o;
  }

  return { store, settings, products, spots, orders, tickets, addOrder };
}

export function plan(rows: Partial<Record<PlanFeature, number | null | false>>): PlanFeatures {
  return {
    planCode: async () => "test",
    has: async (f) => rows[f] !== false,
    limit: async (f) => (rows[f] === false ? null : (rows[f] ?? null)),
  };
}
