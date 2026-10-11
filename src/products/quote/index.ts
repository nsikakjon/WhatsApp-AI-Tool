import { formatNaira } from "../../core/money.js";
import type { Product, Reply } from "../../core/product.js";
import { quoteLine, quoteTotal, type QuoteLine, type Variant } from "./pricing.js";
import type { CatalogStore, OrderStore, SavedOrder } from "./store.js";
import type { Understander } from "./understand.js";

// Phase 1: the quote and order bot (first client: KahnPrints).
//
// 1. The customer says what they want.
// 2. The AI works out which items and how many (understand.ts).
// 3. Code prices it from the database (pricing.ts) and saves the quote.
// 4. The customer replies YES, the quote becomes an order, and the owner gets
//    a WhatsApp alert. (Online payment comes later.)

export interface QuoteProductOptions {
  businessName: string;
  /** Prefix for order numbers shown to people, e.g. "KP" gives KP-1001. */
  orderPrefix: string;
  /** WhatsApp number (digits only) that gets new-order alerts. Optional. */
  ownerWaId?: string;
  catalog: CatalogStore;
  orders: OrderStore;
  ai: Understander;
  log?: Pick<Console, "error">;
}

export function createQuoteProduct(opts: QuoteProductOptions): Product {
  const log = opts.log ?? console;
  const ref = (o: SavedOrder) => `${opts.orderPrefix}-${o.orderNumber}`;

  return {
    name: "quote",
    async handle(msg, ctx): Promise<Reply> {
      // Voice notes arrive here with `text` already filled in by the core.
      if (!msg.text) {
        return {
          text:
            msg.type === "audio"
              ? "Sorry, I couldn't make out that voice note. Could you type what you need (for example: 100 A5 flyers)?"
              : "Please send your request as a message or voice note (for example: 100 A5 flyers).",
        };
      }

      const variants = await opts.catalog.activeVariants();
      if (variants.length === 0) {
        return { text: `Thanks for messaging ${opts.businessName}! Our price list isn't online yet, so someone from the team will get back to you.` };
      }

      let understanding;
      try {
        understanding = await opts.ai.understand({
          text: msg.text,
          history: ctx.history,
          catalog: variants.map((v) => ({ id: v.id, name: v.name, minQuantity: v.minQuantity })),
        });
      } catch (err) {
        log.error("Quote bot could not understand message:", err);
        return { text: "Sorry, I didn't catch that. Could you tell me what you'd like printed and how many?" };
      }

      switch (understanding.intent) {
        case "quote":
          return makeQuote(understanding.items, variants, ctx.contactId, msg.contactName, msg.from);
        case "confirm":
          return confirm(ctx.contactId, msg.contactName, msg.from);
        case "cancel":
          return cancel(ctx.contactId);
        default:
          return { text: safeMessage(understanding.message) ?? defaultHelp(variants) };
      }
    },
  };

  async function makeQuote(
    items: Array<{ variantId: string; quantity: number }>,
    variants: Variant[],
    contactId: string,
    name: string | undefined,
    waId: string,
  ): Promise<Reply> {
    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines: QuoteLine[] = [];
    const problems: string[] = [];
    // Items with no price in the database (priced by the team case by case).
    const manual: string[] = [];

    for (const item of items) {
      const variant = byId.get(item.variantId);
      if (!variant) continue;
      const result = quoteLine(variant, item.quantity);
      if (result.ok) lines.push(result.line);
      else if (result.reason === "below_minimum")
        problems.push(`${variant.name}: the minimum order is ${result.minQuantity}.`);
      else manual.push(`${item.quantity} x ${variant.name}`);
    }

    // Hand items without a set price to the owner instead of guessing.
    const manualNote = manual.length > 0 ? `The team will send you a price for: ${manual.join(", ")}.` : null;
    const notify =
      manual.length > 0 && opts.ownerWaId
        ? [
            {
              to: opts.ownerWaId,
              text: [`Quote request from ${name ?? "a customer"} (+${waId}), please reply to them with a price:`, ...manual.map((m) => `• ${m}`)].join("\n"),
            },
          ]
        : undefined;

    if (lines.length === 0) {
      const text = [...problems, ...(manualNote ? [`Thanks! ${manualNote}`] : [])].join("\n") || defaultHelp(variants);
      return notify ? { text, notify } : { text };
    }

    const order = await opts.orders.createQuote(contactId, lines, quoteTotal(lines));
    const text = [
      `Here's your quote (${ref(order)}):`,
      "",
      ...lines.map((l) => `• ${l.quantity} x ${l.name} @ ${formatNaira(l.unitPriceKobo)} = ${formatNaira(l.totalKobo)}`),
      "",
      `*Total: ${formatNaira(order.totalKobo)}*`,
      ...(problems.length > 0 ? ["", ...problems] : []),
      ...(manualNote ? ["", manualNote] : []),
      "",
      "Reply YES to place this order, or tell me what to change.",
    ].join("\n");
    return notify ? { text, notify } : { text };
  }

  async function confirm(contactId: string, name: string | undefined, waId: string): Promise<Reply> {
    const order = await opts.orders.latestOpenQuote(contactId);
    if (!order || !(await opts.orders.setStatus(order.id, "confirmed"))) {
      return { text: "There's no quote waiting for confirmation. Tell me what you'd like printed and I'll send you one." };
    }

    const reply: Reply = {
      text: `Thank you! Order ${ref(order)} is confirmed (total ${formatNaira(order.totalKobo)}). The ${opts.businessName} team will contact you shortly about payment and delivery.`,
    };
    if (opts.ownerWaId) {
      reply.notify = [
        {
          to: opts.ownerWaId,
          text: [
            `New order ${ref(order)} from ${name ?? "a customer"} (+${waId}):`,
            ...order.lines.map((l) => `• ${l.quantity} x ${l.name} = ${formatNaira(l.totalKobo)}`),
            `Total: ${formatNaira(order.totalKobo)}`,
          ].join("\n"),
        },
      ];
    }
    return reply;
  }

  async function cancel(contactId: string): Promise<Reply> {
    const order = await opts.orders.latestOpenQuote(contactId);
    if (!order) return { text: "No problem. Let me know if you need anything printed." };
    await opts.orders.setStatus(order.id, "cancelled");
    return { text: `No problem, I've cancelled quote ${ref(order)}. Message me any time you need a new one.` };
  }
}

function defaultHelp(variants: Variant[]): string {
  const names = [...new Set(variants.map((v) => v.name.split(":")[0]!.trim()))];
  return `I can give you a quote for: ${names.join(", ")}. Tell me what you need and how many.`;
}

// Anything that looks like money. The AI is told never to mention prices; this
// is the safety net that keeps a model-made amount from reaching a customer.
const MONEY = /₦|naira|\bngn\b|kobo|\bN\s?\d|\d\s*k\b|\bprice (is|of)\b|\bcosts?\b|\btotal\b|\d{1,3}(,\d{3})+/i;

export function safeMessage(message: string | null): string | null {
  if (!message || !message.trim()) return null;
  return MONEY.test(message) ? null : message.trim();
}
