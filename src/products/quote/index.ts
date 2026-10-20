import { formatNaira } from "../../core/money.js";
import type { Product, ProductContext, Reply } from "../../core/product.js";
import type { OutgoingImage } from "../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { DeliveryCharge, Dispatch } from "./delivery/index.js";
import { formatDocDate, renderDocument, type DocumentInput } from "./documents.js";
import { quoteLine, quoteTotal, type QuoteLine, type Variant } from "./pricing.js";
import type { BrandingStore, CatalogStore, OrderDetails, OrderStore, SavedOrder } from "./store.js";
import type { Understander } from "./understand.js";

// The quote and order bot. Any business can use it with its own price list
// (see store.ts and businesses.ts for how several businesses share it).
//
// 1. The customer says what they want.
// 2. The AI works out which items and how many (understand.ts).
// 3. Code prices it from the database (pricing.ts) and saves the quote.
// 4. The customer replies YES, the quote becomes an order, the customer gets
//    an invoice (a picture with the business logo) and the owner gets a
//    WhatsApp alert.
// 5. When the customer has paid, the owner sends "paid KP-1001" and the
//    customer gets a receipt.
//
// The owner can also send the business logo (a photo captioned "logo"), and
// "invoice KP-1001" or "receipt KP-1001" for a copy to forward or print.
//
// With delivery switched on (delivery/index.ts), the bot asks where to deliver
// between the YES and the order, and the owner sends riders out from WhatsApp.

export interface QuoteProductOptions {
  businessName: string;
  /** Prefix for order numbers shown to people, e.g. "KP" gives KP-1001. */
  orderPrefix: string;
  /** WhatsApp number (digits only) that gets new-order alerts. Optional. */
  ownerWaId?: string;
  catalog: CatalogStore;
  orders: OrderStore;
  ai: Understander;
  /** Where the logo for invoices and receipts is kept. Without it, documents have no logo. */
  branding?: BrandingStore;
  /** Address or phone printed under the business name on invoices and receipts. */
  businessDetails?: string;
  /** Bank details printed on invoices, e.g. "GTBank 0123456789, Example Ltd". */
  paymentDetails?: string;
  /** Delivery addresses, fees and riders. Without it, the team arranges delivery themselves. */
  delivery?: Dispatch;
  /** Draws invoices and receipts. Tests swap in a fake; normally documents.ts. */
  renderDocument?: (input: DocumentInput) => Promise<Uint8Array>;
  log?: Pick<Console, "error">;
}

export function createQuoteProduct(opts: QuoteProductOptions): Product {
  const log = opts.log ?? console;
  const ref = (o: SavedOrder) => `${opts.orderPrefix}-${o.orderNumber}`;
  const draw = opts.renderDocument ?? renderDocument;

  return {
    name: "quote",
    async handle(msg, ctx): Promise<Reply> {
      if (opts.ownerWaId && msg.from === opts.ownerWaId) {
        const ownerReply = await ownerCommand(msg, ctx);
        if (ownerReply) return ownerReply;
      }
      if (opts.delivery) {
        const deliveryReply = await opts.delivery.handle(msg, ctx);
        if (deliveryReply) return deliveryReply;
      }

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
        return { text: "Sorry, I didn't catch that. Could you tell me what you'd like and how many?" };
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
    if (order && opts.delivery) {
      const ask = await opts.delivery.beforeConfirm(order, { waId, name });
      if (ask) return ask;
    }
    if (!order || !(await opts.orders.setStatus(order.id, "confirmed"))) {
      return { text: "There's no quote waiting for confirmation. Tell me what you'd like and I'll send you one." };
    }

    const delivery = opts.delivery ? await opts.delivery.charge(order.id) : null;
    const invoice = await documentImage("invoice", { ...order, customerWaId: waId, customerName: name ?? null, createdAt: new Date() }, delivery);
    const next = opts.delivery
      ? delivery
        ? "We'll send you a link to follow your delivery once a rider is on the way."
        : `The ${opts.businessName} team will let you know when it's ready.`
      : `The ${opts.businessName} team will contact you shortly about delivery.`;
    const reply: Reply = {
      text: invoice
        ? `Thank you! Order ${ref(order)} is confirmed. Here's your invoice for ${formatNaira(order.totalKobo)}. ${next}`
        : `Thank you! Order ${ref(order)} is confirmed (total ${formatNaira(order.totalKobo)}). The ${opts.businessName} team will contact you shortly about payment${opts.delivery ? "" : " and delivery"}.`,
      ...(invoice ? { images: [invoice] } : {}),
    };
    if (opts.ownerWaId) {
      const note = opts.delivery ? await opts.delivery.ownerNote(order) : null;
      reply.notify = [
        {
          to: opts.ownerWaId,
          text: [
            `New order ${ref(order)} from ${name ?? "a customer"} (+${waId}):`,
            ...order.lines.map((l) => `• ${l.quantity} x ${l.name} = ${formatNaira(l.totalKobo)}`),
            ...(delivery ? [`• ${delivery.label} = ${formatNaira(delivery.feeKobo)}`] : []),
            `Total: ${formatNaira(order.totalKobo)}`,
            ...(note ? ["", note] : []),
            "",
            `When they've paid, reply *paid ${ref(order)}* and I'll send them a receipt.`,
          ].join("\n"),
        },
      ];
    }
    return reply;
  }

  /** Draws an invoice or receipt for an order. Returns null if drawing fails, so the chat carries on in text. */
  async function documentImage(
    kind: "invoice" | "receipt",
    order: Pick<OrderDetails, "orderNumber" | "lines" | "totalKobo" | "customerWaId" | "customerName" | "createdAt"> & { paidAt?: Date | null },
    delivery: DeliveryCharge | null,
  ): Promise<OutgoingImage | null> {
    try {
      const logo = opts.branding ? await opts.branding.logo() : null;
      const data = await draw({
        kind,
        businessName: opts.businessName,
        logo: logo ?? undefined,
        businessDetails: opts.businessDetails,
        ref: `${opts.orderPrefix}-${order.orderNumber}`,
        date: kind === "receipt" ? (order.paidAt ?? new Date()) : order.createdAt,
        customerName: order.customerName ?? undefined,
        customerWaId: order.customerWaId,
        lines: order.lines,
        ...(delivery ? { delivery } : {}),
        totalKobo: order.totalKobo,
        paymentDetails: opts.paymentDetails,
      });
      const label = kind === "invoice" ? "Invoice" : "Receipt";
      return { data, mimeType: "image/jpeg", caption: `${label} ${opts.orderPrefix}-${order.orderNumber}` };
    } catch (err) {
      log.error(`Could not draw the ${kind} for order ${order.orderNumber}:`, err);
      return null;
    }
  }

  /**
   * Messages only the business owner can send: the logo, and invoice, receipt
   * and paid commands. Returns null for anything else, so the owner can still
   * try the bot like a customer.
   */
  async function ownerCommand(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
    const caption = (msg.caption ?? "").trim();
    if ((msg.type === "image" || msg.type === "document") && msg.mediaId) {
      if (!/^logo$/i.test(caption)) {
        return opts.branding
          ? { text: "To use this picture as the logo on your invoices and receipts, send it again with the caption *logo*." }
          : null;
      }
      if (!opts.branding) return { text: "Logos can't be saved yet on this setup. Please let yarnOga support know." };
      const file = await ctx.downloadMedia(msg.mediaId);
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimeType)) {
        return { text: "Please send the logo as a picture (PNG or JPEG). A PNG sent as a document keeps a see-through background." };
      }
      await opts.branding.saveLogo(new Uint8Array(await file.data.arrayBuffer()), file.mimeType);
      return { text: "Logo saved ✅ It'll be on every invoice and receipt from now on." };
    }

    const text = (msg.text ?? "").trim();
    if (/^(logo|invoice|receipt|paid)$/i.test(text)) return { text: ownerHelp(opts.orderPrefix) };
    const command = text.match(/^(invoice|receipt|paid)\s*#?\s*(?:[a-z]+\s*-?\s*)?(\d+)\.?$/i);
    if (!command) return null;

    const action = command[1]!.toLowerCase();
    const number = Number(command[2]);
    const label = `${opts.orderPrefix}-${number}`;
    const order = await opts.orders.findOrder(number);
    if (!order) return { text: `I can't find order ${label}. Please check the number.` };
    const delivery = opts.delivery ? await opts.delivery.charge(order.id) : null;

    if (action === "invoice") {
      const invoice = await documentImage("invoice", order, delivery);
      return invoice ? { text: `Invoice for ${label} (${formatNaira(order.totalKobo)}):`, images: [invoice] } : { text: DRAW_FAILED };
    }

    if (action === "receipt") {
      if (order.status !== "paid") return { text: `${label} isn't marked paid yet. Send *paid ${label}* once the customer has paid.` };
      const receipt = await documentImage("receipt", order, delivery);
      return receipt ? { text: `Receipt for ${label}:`, images: [receipt] } : { text: DRAW_FAILED };
    }

    // paid
    if (order.status === "cancelled") return { text: `${label} was cancelled, so I can't mark it paid.` };
    if (order.status === "paid") {
      const receipt = await documentImage("receipt", order, delivery);
      return {
        text: `${label} was already marked paid${order.paidAt ? ` on ${formatDocDate(order.paidAt)}` : ""}. Here's the receipt again:`,
        ...(receipt ? { images: [receipt] } : {}),
      };
    }
    if (!(await opts.orders.markPaid(order.id))) {
      return { text: `${label} has just been updated by another message. Send *receipt ${label}* to see where it stands.` };
    }
    const paid = { ...order, status: "paid" as const, paidAt: new Date() };
    const receipt = await documentImage("receipt", paid, delivery);
    const note = opts.delivery ? await opts.delivery.ownerNote(order) : null;
    const who = order.customerName ?? `+${order.customerWaId}`;
    return {
      text:
        (receipt
          ? `✅ ${label} marked paid (${formatNaira(order.totalKobo)}). I've sent ${who} this receipt. If they haven't messaged in the last 24 hours WhatsApp may hold it back, so you can forward this copy.`
          : `✅ ${label} marked paid (${formatNaira(order.totalKobo)}). I've told ${who}, but couldn't draw the receipt.`) +
        (note ? `\n\n${note}` : ""),
      ...(receipt ? { images: [receipt] } : {}),
      notify: [
        {
          to: order.customerWaId,
          text: `Payment received for order ${label} (${formatNaira(order.totalKobo)}). Thank you for choosing ${opts.businessName}!${receipt ? " Here's your receipt:" : ""}`,
          ...(receipt ? { images: [receipt] } : {}),
        },
      ],
    };
  }

  async function cancel(contactId: string): Promise<Reply> {
    const order = await opts.orders.latestOpenQuote(contactId);
    if (!order) return { text: "No problem. Let me know if you need anything else." };
    await opts.orders.setStatus(order.id, "cancelled");
    return { text: `No problem, I've cancelled quote ${ref(order)}. Message me any time you need a new one.` };
  }
}

const DRAW_FAILED = "Sorry, I couldn't draw that just now. Please try again in a minute.";

function ownerHelp(prefix: string): string {
  return [
    "Invoices and receipts:",
    "• Send your logo as a picture with the caption *logo* to put it on every invoice and receipt.",
    `• *paid ${prefix}-1001* marks an order paid and sends the customer a receipt.`,
    `• *invoice ${prefix}-1001* or *receipt ${prefix}-1001* sends you a copy.`,
    "Customers get their invoice automatically when they confirm an order.",
  ].join("\n");
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
