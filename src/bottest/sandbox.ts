import type { Product, Reply } from "../core/product.js";
import type { QuoteLine } from "../products/quote/pricing.js";
import type { BrandingStore, OrderDetails, OrderStore, SavedOrder } from "../products/quote/store.js";
import type { Lead, LeadStore } from "../products/leads/store.js";

// Runs one test question through a bot without anything leaving the server.
// Each question gets a newly made bot and a pretend customer with a fresh
// chat, stores that only live in
// memory (so no test quote, order or lead lands in the database), and its
// reply is shown on the screen instead of being sent on WhatsApp. Alerts the
// bot would send (to the owner or agents) are counted, never sent.

/** The pretend owner (or agent) the test bots alert. Not a phone number, and alerts are never sent anyway. */
export const TEST_OWNER = "test-owner";
/** The pretend customer. Not a phone number either. */
const TEST_CUSTOMER = "test-customer";

export interface TestAnswer {
  /** What the customer would see. */
  text: string;
  /** Pictures the bot would send, e.g. an invoice. */
  pictures: number;
  /** Choices in a tappable list, if the bot sent one. */
  choices: string[];
  /** How many alerts would go to the owner or agents. */
  alerts: number;
}

let counter = 0;

export async function askBot(product: Product, question: string): Promise<TestAnswer> {
  counter += 1;
  const later: Reply[] = [];
  const reply = await product.handle(
    {
      waMessageId: `test-${Date.now()}-${counter}`,
      from: `${TEST_CUSTOMER}-${counter}`,
      contactName: "Test customer",
      type: "text",
      text: question,
      timestamp: Math.floor(Date.now() / 1000),
      raw: null,
    },
    {
      contactId: `test-contact-${counter}`,
      history: [],
      downloadMedia: async () => {
        throw new Error("The test screen has no attachments");
      },
      sendLater: async (r) => {
        later.push(r);
      },
      canMessageFreely: async () => true,
    },
  );

  const replies = [reply, ...later].filter((r): r is Reply => r !== null);
  return {
    text: replies.map((r) => r.text).filter(Boolean).join("\n\n"),
    pictures: replies.reduce((n, r) => n + (r.images?.length ?? 0), 0),
    choices: replies.flatMap((r) => r.list?.rows.map((row) => row.title) ?? []),
    alerts: replies.reduce((n, r) => n + (r.notify?.length ?? 0), 0),
  };
}

/** Quotes and orders kept in memory, so test quotes never reach the order list. */
export function memoryOrderStore(): OrderStore {
  const orders: Array<OrderDetails & { contactId: string }> = [];
  return {
    async createQuote(contactId: string, lines: QuoteLine[], totalKobo: number): Promise<SavedOrder> {
      const order = {
        id: `test-order-${orders.length + 1}`,
        orderNumber: 1000 + orders.length + 1,
        totalKobo,
        lines,
        status: "quoted" as const,
        customerWaId: TEST_CUSTOMER,
        customerName: "Test customer",
        createdAt: new Date(),
        paidAt: null,
        contactId,
      };
      orders.push(order);
      return order;
    },
    async latestOpenQuote(contactId) {
      return [...orders].reverse().find((o) => o.contactId === contactId && o.status === "quoted") ?? null;
    },
    async setStatus(orderId, status) {
      const order = orders.find((o) => o.id === orderId);
      if (!order || order.status !== "quoted") return false;
      order.status = status;
      return true;
    },
    async findOrder(orderNumber) {
      return orders.find((o) => o.orderNumber === orderNumber) ?? null;
    },
    async markPaid(orderId) {
      const order = orders.find((o) => o.id === orderId);
      if (!order || (order.status !== "quoted" && order.status !== "confirmed")) return false;
      order.status = "paid";
      order.paidAt = new Date();
      return true;
    },
  };
}

/** Reads the real logo (for invoices) but can never change it. */
export function readOnlyBranding(real: BrandingStore): BrandingStore {
  return {
    logo: () => real.logo(),
    async saveLogo() {},
  };
}

/** Leads kept in memory, so test chats never show up as real enquiries. */
export function memoryLeadStore(): LeadStore {
  const leads = new Map<string, Lead>();
  return {
    async findLead(waId) {
      return leads.get(waId) ?? null;
    },
    async saveLead(waId, update) {
      const existing = leads.get(waId);
      const lead: Lead = {
        id: existing?.id ?? `test-lead-${leads.size + 1}`,
        waId,
        alertedAt: existing?.alertedAt ?? null,
        updatedAt: new Date(),
        ...update,
      };
      leads.set(waId, lead);
      return lead;
    },
    async claimAlert(leadId) {
      const lead = [...leads.values()].find((l) => l.id === leadId);
      if (!lead || lead.alertedAt) return false;
      lead.alertedAt = new Date();
      return true;
    },
    async recentLeads(limit) {
      return [...leads.values()].slice(-limit).reverse();
    },
  };
}
