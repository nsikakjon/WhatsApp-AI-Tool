// Shared by the ticket tests: tickets kept in memory, shaped like the Supabase tables.
import { createTicketLinks } from "./links.js";
import type { EventTicket, TicketStore } from "./store.js";

export const BUSINESS = "00000000-0000-0000-0000-000000000002";
export const SECRET = "test-secret";
export const links = createTicketLinks(SECRET, "https://bot.example.com");

export function memoryTickets() {
  const products = [
    { id: "p-regular", name: "Element House: Regular", ticket: true },
    { id: "p-vip", name: "Element House: VIP", ticket: true },
    { id: "p-tee", name: "T-shirt", ticket: false },
  ];
  const variantProduct: Record<string, string> = { "v-regular": "p-regular", "v-vip": "p-vip", "v-tee": "p-tee" };
  const orders = new Map<string, { orderNumber: number; contactId: string; holderName: string | null; holderWaId: string }>();
  const tickets: Array<EventTicket & { createdAt: Date }> = [];
  let next = 1;

  const store: TicketStore = {
    products: async () => products.map((p) => ({ ...p })),
    async setTicket(productId, ticket) {
      products.find((p) => p.id === productId)!.ticket = ticket;
    },
    async ticketVariants(ids) {
      return new Set(ids.filter((id) => products.find((p) => p.id === variantProduct[id])?.ticket));
    },
    async issue(orderId, list) {
      const o = orders.get(orderId)!;
      for (const t of list) {
        if (tickets.some((x) => x.orderId === orderId && x.seat === t.seat)) continue;
        const id = `00000000-0000-0000-0000-${String(next++).padStart(12, "0")}`;
        tickets.push({ id, orderId, orderNumber: o.orderNumber, holderName: o.holderName, holderWaId: o.holderWaId, checkedInAt: null, createdAt: new Date(), ...t });
      }
      return store.forOrder(orderId);
    },
    forOrder: async (orderId) => tickets.filter((t) => t.orderId === orderId).sort((a, b) => a.seat - b.seat),
    ticket: async (id) => tickets.find((t) => t.id === id) ?? null,
    findByCode: async (n, code) => tickets.find((t) => t.orderNumber === n && t.code === code) ?? null,
    async checkIn(id) {
      const t = tickets.find((x) => x.id === id && !x.checkedInAt);
      if (!t) return null;
      t.checkedInAt = new Date();
      return t;
    },
    unusedFor: async (contactId, since) =>
      tickets.filter((t) => orders.get(t.orderId)?.contactId === contactId && !t.checkedInAt && t.createdAt >= since),
    async counts() {
      const byName = new Map<string, { name: string; sold: number; checkedIn: number }>();
      for (const t of tickets) {
        const c = byName.get(t.name) ?? { name: t.name, sold: 0, checkedIn: 0 };
        c.sold += 1;
        if (t.checkedInAt) c.checkedIn += 1;
        byName.set(t.name, c);
      }
      return [...byName.values()];
    },
  };

  function addOrder(id: string, orderNumber: number, contactId = "c1") {
    orders.set(id, { orderNumber, contactId, holderName: "Ada", holderWaId: "2348012345678" });
  }

  return { store, products, tickets, addOrder };
}
