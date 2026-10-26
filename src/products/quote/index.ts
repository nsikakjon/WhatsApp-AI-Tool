import { formatNaira } from "../../core/money.js";
import type { Notice, Product, ProductContext, Reply } from "../../core/product.js";
import type { OutgoingImage } from "../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { DeliveryCharge, Dispatch } from "./delivery/index.js";
import { formatDocDate, renderDocument, type DocumentInput, type Pickup } from "./documents.js";
import { isStopRequest } from "./followups.js";
import { quoteLine, quoteTotal, type QuoteLine, type Variant } from "./pricing.js";
import { CARDS_PAGE, type Catalogue } from "./catalogue.js";
import type { AiCredits } from "./credits.js";
import type { MessageAllowance } from "./messages.js";
import { createKeywordUnderstander } from "./fallback.js";
import type { PlanFeatures } from "./features.js";
import type { PlanGate } from "./plan.js";
import type { BrandingStore, CatalogStore, OrderDetails, OrderStore, SavedOrder } from "./store.js";
import type { Understander } from "./understand.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { customerWelcome, ownerMenu, QUOTE_CHOICE, TEAM_CHOICE, welcomeAsk } from "./welcome.js";
import type { WalkIn, WalkInMode } from "./walkin/index.js";

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
// The owner can also send the business logo (a photo captioned "logo"),
// "invoice KP-1001" or "receipt KP-1001" for a copy to forward or print, and
// "orders" for the link to their order board and sales (board.ts), and
// "stock" or product photos (catalogue.ts).
//
// With a plan set (QUOTE_PLAN, see plan.ts), the free plan stops confirming
// orders after its monthly limit and adds a "Powered by yarnOga" line, and
// the owner can send "plan" to see their use and how to upgrade.
//
// With plan features on (QUOTE_PLAN_FEATURES, see features.ts and credits.ts),
// each plan gets a monthly number of AI replies; after that the bot keeps
// quoting with simple menu replies (fallback.ts). Voice notes and invoice
// pictures follow the plan too.
//
// With delivery switched on (delivery/index.ts) and on the plan, the bot asks
// where to deliver between the YES and the order, and the owner sends riders
// out from WhatsApp.
//
// With pay links on (paylinks.ts), the invoice comes with a Paystack link.
// Once Paystack confirms the payment, orderPaid marks the order paid and the
// customer gets a receipt, as if the owner had sent "paid KP-1001".
//
// With walk-in orders on (walkin/), the bot skips delivery, paid orders go
// to the kitchen and bar screens, and the receipt carries a QR code that
// staff scan when the customer collects.
//
// "hi" gets a welcome with how ordering works (welcome.ts); "menu" brings it
// back, or the owner's command list when the owner sends it.

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
  /**
   * Stops quote reminders to this customer (they replied STOP). Only set
   * while quote follow-ups are on (see followups.ts); otherwise STOP is
   * understood like any other message.
   */
  optOutOfFollowUps?: (contactId: string) => Promise<void>;
  /** The business's plan (order limit, credit line). Without it, no limits apply. */
  plan?: PlanGate;
  /** What the plan includes (voice notes, invoices). Without it, everything is included. */
  features?: PlanFeatures;
  /** The plan's monthly AI replies. Without it, the AI reads every message. */
  credits?: AiCredits;
  /** Reads messages without AI once credits run out. Normally fallback.ts. */
  simpleAi?: Understander;
  /** The plan's monthly WhatsApp messages on a number yarnOga pays for (messages.ts). Without it, nothing is checked. */
  botMessages?: MessageAllowance;
  /** Product photos and stock levels (catalogue.ts). Without it, stock isn't counted. */
  catalogue?: Catalogue;
  /** The owner's private orders page (board.ts), sent when they send "orders". */
  ordersLink?: string;
  /** The owner's "referral" reply: their referral code and how often it's been used (referrals.ts). */
  referral?: () => Promise<string>;
  /** Makes an online payment link for a confirmed order (paylinks.ts). Without it, customers pay the business directly. */
  payLink?: (order: SavedOrder, waId: string) => Promise<string>;
  /** Walk-in orders for restaurants, bars and events (walkin/). Without it, every order is delivered or arranged by the team. */
  walkIn?: WalkIn;
  log?: Pick<Console, "error">;
}

/** How an order was paid outside the owner's "paid KP-1001": online by pay link (with yarnOga's fee, in kobo), or at a walk-in counter. */
/** How an order was paid: by pay link, at a walk-in counter, or marked paid by staff in the owner app (e.g. a bank transfer). */
export type PaidVia = { how: "online"; feeKobo: number } | { how: "counter" } | { how: "app" };

export interface QuoteProduct extends Product {
  /** Marks an order paid after Paystack confirmed its pay link (or staff took payment at the counter), and returns the receipt and owner messages. */
  orderPaid(orderNumber: number, via?: PaidVia): Promise<Notice[]>;
}

const WALK_IN_OFF: WalkInMode = { on: false, paused: false };

export function createQuoteProduct(opts: QuoteProductOptions): QuoteProduct {
  const log = opts.log ?? console;
  const ref = (o: SavedOrder) => `${opts.orderPrefix}-${o.orderNumber}`;
  const draw = opts.renderDocument ?? renderDocument;
  const simpleAi = opts.simpleAi ?? createKeywordUnderstander();

  return {
    name: "quote",
    async handle(msg, ctx): Promise<Reply> {
      if (opts.ownerWaId && msg.from === opts.ownerWaId) {
        const ownerReply = await ownerCommand(msg, ctx);
        if (ownerReply) return ownerReply;
      }
      const venue = await walkInMode();
      if (venue.on) {
        const spotReply = await opts.walkIn!.customerMessage(msg, ctx.contactId);
        if (spotReply) return spotReply;
      }
      const walkIn = venue.on && (await walkInChat(ctx.contactId)) ? venue : WALK_IN_OFF;
      if (!walkIn.on && opts.delivery && (await deliveryOnPlan())) {
        const deliveryReply = await opts.delivery.handle(msg, ctx);
        if (deliveryReply) return deliveryReply;
      }

      // Voice notes arrive here with `text` already filled in by the core.
      if (msg.type === "audio" && opts.features && !(await opts.features.has("voice_notes"))) {
        return { text: "Sorry, I can't take voice notes on this line. Please type what you need (for example: 100 A5 flyers)." };
      }
      if (!msg.text) {
        return {
          text:
            msg.type === "audio"
              ? "Sorry, I couldn't make out that voice note. Could you type what you need (for example: 100 A5 flyers)?"
              : "Please send your request as a message or voice note (for example: 100 A5 flyers).",
        };
      }

      if (opts.optOutOfFollowUps && isStopRequest(msg.text)) {
        await opts.optOutOfFollowUps(ctx.contactId);
        return { text: "Okay, I won't send you any more quote reminders. Message me any time you need a quote." };
      }

      const variants = await opts.catalog.activeVariants();
      if (variants.length === 0) {
        return { text: `Thanks for messaging ${opts.businessName}! Our price list isn't online yet, so someone from the team will get back to you.` };
      }
      const welcome = await welcomeReply(msg, variants, walkIn);
      if (welcome) return welcome;

      // A tap on "See more" under the product cards: no need for the AI.
      const page = msg.text.trim().match(CARDS_PAGE);
      if (page && opts.catalogue) {
        const cards = await opts.catalogue.cards(variants, Number(page[1]));
        if (cards) return cards;
      }

      // Out of AI credits: simple menu replies instead, and the owner hears about it.
      const credit = opts.credits ? await opts.credits.spend() : { useAi: true, ownerNotice: null };
      const input = {
        text: msg.text,
        history: ctx.history,
        catalog: variants.map((v) => ({ id: v.id, name: v.name, minQuantity: v.minQuantity })),
      };
      let understanding;
      let simple = !credit.useAi;
      try {
        understanding = await (simple ? simpleAi : opts.ai).understand(input);
      } catch (err) {
        log.error("Quote bot could not understand message:", err);
        // With plan features on, an AI outage falls back to the menu too.
        if (simple || !opts.credits) return { text: "Sorry, I didn't catch that. Could you tell me what you'd like and how many?" };
        simple = true;
        understanding = await simpleAi.understand(input);
      }

      let reply: Reply;
      switch (understanding.intent) {
        case "quote":
          reply = walkIn.paused ? closedReply() : await makeQuote(understanding.items, variants, ctx.contactId, msg.contactName, msg.from);
          break;
        case "confirm":
          reply = walkIn.paused ? closedReply() : await confirm(ctx.contactId, msg.contactName, msg.from, walkIn);
          break;
        case "cancel":
          reply = await cancel(ctx.contactId);
          break;
        case "catalogue":
          reply = (opts.catalogue && (await opts.catalogue.cards(variants, 1, understanding.show))) || {
            text: (simple ? understanding.message : safeMessage(understanding.message)) ?? defaultHelp(variants),
          };
          break;
        default:
          // The simple replies are written in code, not by the AI, so they can list items freely.
          reply = { text: (simple ? understanding.message : safeMessage(understanding.message)) ?? defaultHelp(variants) };
      }
      const messagesNotice = opts.botMessages ? await opts.botMessages.check() : null;
      for (const notice of [credit.ownerNotice, messagesNotice]) {
        if (notice && opts.ownerWaId) reply.notify = [...(reply.notify ?? []), { to: opts.ownerWaId, text: notice }];
      }
      return reply;
    },

    async orderPaid(orderNumber, via = { how: "online", feeKobo: 0 }) {
      const label = `${opts.orderPrefix}-${orderNumber}`;
      const order = await opts.orders.findOrder(orderNumber);
      if (!order) throw new Error(`Order ${label} was paid online but can't be found`);
      const toOwner = (text: string): Notice[] => (opts.ownerWaId ? [{ to: opts.ownerWaId, text }] : []);
      const who = order.customerName ?? showWaId(order.customerWaId);
      if (order.status === "paid" || order.status === "cancelled" || !(await opts.orders.markPaid(order.id))) {
        if (via.how !== "online") return [];
        return toOwner(
          `⚠️ ${who} paid ${label} online (${formatNaira(order.totalKobo)}), but it was already ${order.status === "cancelled" ? "cancelled" : "marked paid"}. If they've paid twice, message yarnOga support to refund the online payment.`,
        );
      }
      const pickup = await walkInPaid(order);
      const delivery = opts.delivery ? await opts.delivery.charge(order.id) : null;
      const receipt = await documentImage("receipt", { ...order, paidAt: new Date() }, delivery, pickup);
      const note = !pickup && opts.delivery && (await deliveryOnPlan()) ? await opts.delivery.ownerNote(order) : null;
      const how =
        via.how === "counter"
          ? `💰 ${label} was paid at the counter (${formatNaira(order.totalKobo)}). I've sent ${who} their receipt.`
          : via.how === "app"
            ? `💰 ${label} was marked paid in the app (${formatNaira(order.totalKobo)}). I've sent ${who} their receipt.`
            : `💰 ${label} paid online (${formatNaira(order.totalKobo)}) by ${who}. I've sent them their receipt, and Paystack pays the money into your bank account` +
            (via.feeKobo > 0 ? `, less the yarnOga fee (${formatNaira(via.feeKobo)}) and Paystack's fee.` : ".");
      return [
        receiptNote(order, label, receipt, pickup),
        ...toOwner(how + (pickup ? `\n\nIt's on your pickup ${pickup.stations.length > 1 ? "screens" : "screen"}: ${pickup.stations.join(", ")}.` : "") + (note ? `\n\n${note}` : "")),
      ];
    },
  };

  async function welcomeReply(msg: IncomingMessage, variants: Variant[], walkIn: WalkInMode): Promise<Reply | null> {
    const text = msg.text!.trim();
    if (text.toLowerCase() === QUOTE_CHOICE) return { text: defaultHelp(variants) };
    if (text.toLowerCase() === TEAM_CHOICE && opts.ownerWaId) {
      return {
        text: `I've let the ${opts.businessName} team know. Someone will reply to you here shortly.`,
        notify: [{ to: opts.ownerWaId, text: `${msg.contactName ?? "A customer"} (${showWaId(msg.from)}) would like to talk to someone. Please reply to them on WhatsApp.` }],
      };
    }
    const ask = welcomeAsk(text);
    if (!ask) return null;
    if (ask === "catalogue" && opts.catalogue) {
      const cards = await opts.catalogue.cards(variants, 1);
      if (cards) return cards;
    }
    const reply = customerWelcome({
      businessName: opts.businessName,
      customerName: msg.contactName,
      items: variants,
      voiceNotes: opts.features ? await opts.features.has("voice_notes") : true,
      delivery: !walkIn.on && !!opts.delivery && (await deliveryOnPlan()),
      invoices: await documentsIncluded(),
      catalogue: !!opts.catalogue,
      team: !!opts.ownerWaId,
    });
    if (opts.ownerWaId && msg.from === opts.ownerWaId && reply.buttons) {
      reply.buttons.body += "\n\nYou're the owner: send *menu* for your commands.";
    }
    return reply;
  }

  function receiptNote(order: OrderDetails, label: string, receipt: OutgoingImage | null, pickup: Pickup | null): Notice {
    const thanks = `Payment received for order ${label} (${formatNaira(order.totalKobo)}). Thank you for choosing ${opts.businessName}!`;
    if (pickup) {
      const where = pickup.table ? `We'll bring it to ${pickup.table}.` : "We'll message you when it's ready to collect.";
      return {
        to: order.customerWaId,
        text: `${thanks} ${where} ${receipt ? "Show the QR code on this receipt when you collect" : `Show this message when you collect. Your code is ${pickup.code}`}.`,
        ...(receipt ? { images: [receipt] } : {}),
      };
    }
    return {
      to: order.customerWaId,
      text: `${thanks}${receipt ? " Here's your receipt:" : ""}`,
      ...(receipt ? { images: [receipt] } : {}),
    };
  }

  function closedReply(): Reply {
    return { text: `Sorry, ${opts.businessName} isn't taking new orders right now. Please ask a member of staff.` };
  }

  /** Walk-in mode, read each time so "walk-in on" takes effect at once. Off if it can't be read. */
  async function walkInMode(): Promise<WalkInMode> {
    if (!opts.walkIn) return WALK_IN_OFF;
    try {
      return await opts.walkIn.mode();
    } catch (err) {
      log.error("Could not read the walk-in setting:", err);
      return WALK_IN_OFF;
    }
  }

  /**
   * Whether this chat is a walk-in one. A business that delivers keeps
   * delivering to everyone who hasn't checked in at the venue.
   */
  async function walkInChat(contactId: string): Promise<boolean> {
    if (!opts.delivery || !(await deliveryOnPlan())) return true;
    try {
      return await opts.walkIn!.checkedIn(contactId);
    } catch (err) {
      log.error("Could not read the customer's check-in:", err);
      return false;
    }
  }

  /** A paid walk-in order goes to its screens; the receipt gets the pickup box. Null for other orders. */
  async function walkInPaid(order: SavedOrder): Promise<Pickup | null> {
    if (!opts.walkIn) return null;
    try {
      return await opts.walkIn.paid(order);
    } catch (err) {
      log.error(`Couldn't send order ${ref(order)} to the pickup screens:`, err);
      return null;
    }
  }

  /** The order's pay link, or null so the customer pays the business directly if Paystack is down. */
  async function payLinkFor(order: SavedOrder, waId: string): Promise<string | null> {
    if (!opts.payLink) return null;
    try {
      return await opts.payLink(order, waId);
    } catch (err) {
      log.error(`Couldn't make a pay link for order ${ref(order)}:`, err);
      return null;
    }
  }

  async function makeQuote(
    items: Array<{ variantId: string; quantity: number }>,
    variants: Variant[],
    contactId: string,
    name: string | undefined,
    waId: string,
  ): Promise<Reply> {
    const byId = new Map(variants.map((v) => [v.id, v]));
    let lines: QuoteLine[] = [];
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

    if (opts.catalogue && lines.length > 0) {
      const short = await opts.catalogue.shortages(lines);
      problems.push(...short.values());
      lines = lines.filter((l) => !short.has(l.variantId));
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
    const credit = opts.plan ? await opts.plan.credit() : null;
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
      ...(credit ? ["", credit] : []),
    ].join("\n");
    const photos = opts.catalogue ? await opts.catalogue.photos(lines) : [];
    return { text, ...(photos.length ? { images: photos } : {}), ...(notify ? { notify } : {}) };
  }

  async function confirm(contactId: string, name: string | undefined, waId: string, walkIn: WalkInMode): Promise<Reply> {
    const order = await opts.orders.latestOpenQuote(contactId);
    const noQuote = { text: "There's no quote waiting for confirmation. Tell me what you'd like and I'll send you one." };
    if (!order) return noQuote;

    // Over the plan's monthly limit: the quote stays open and the owner takes
    // it from here, so the sale isn't lost.
    const check = opts.plan ? await opts.plan.checkOrder() : ({ allowed: true, warning: null } as const);
    if (!check.allowed) {
      return {
        text: `Thank you! The ${opts.businessName} team will contact you shortly to complete order ${ref(order)} (total ${formatNaira(order.totalKobo)}).`,
        ...(opts.ownerWaId
          ? {
              notify: [
                {
                  to: opts.ownerWaId,
                  text: [
                    `${name ?? "A customer"} (+${waId}) wants to order ${ref(order)}:`,
                    ...order.lines.map((l) => `• ${l.quantity} x ${l.name} = ${formatNaira(l.totalKobo)}`),
                    `Total: ${formatNaira(order.totalKobo)}`,
                    "",
                    `You've used all ${check.limit} orders on your ${check.planName} plan this month, so I haven't confirmed it or sent an invoice. Please reply to them yourself. Send *paid ${ref(order)}* once they've paid, or *plan* to see how to upgrade.`,
                  ].join("\n"),
                },
              ],
            }
          : {}),
      };
    }

    const dispatch = !walkIn.on && opts.delivery && (await deliveryOnPlan()) ? opts.delivery : undefined;
    if (dispatch) {
      const ask = await dispatch.beforeConfirm(order, { waId, name });
      if (ask) return ask;
    }
    if (!(await opts.orders.setStatus(order.id, "confirmed"))) return noQuote;
    await opts.catalogue?.confirmed(order.id);
    let spot: { code: string; table: string | null } | null = null;
    if (walkIn.on) {
      try {
        spot = await opts.walkIn!.confirmed(order, contactId);
      } catch (err) {
        log.error(`Couldn't give order ${ref(order)} a pickup code:`, err);
      }
    }

    const delivery = dispatch ? await dispatch.charge(order.id) : null;
    const invoice = await documentImage("invoice", { ...order, customerWaId: waId, customerName: name ?? null, createdAt: new Date() }, delivery);
    const payUrl = await payLinkFor(order, waId);
    const payLine = payUrl ? `Pay online by card, bank transfer or USSD: ${payUrl}` : null;
    if (invoice && payLine) invoice.caption = `${invoice.caption}\n\n${payLine}`;
    const next = spot
      ? payUrl
        ? "Pay with the link, then show the QR code on your receipt when you collect."
        : `Please pay at the counter and give them your order number, ${ref(order)}.`
      : dispatch
      ? delivery
        ? "We'll send you a link to follow your delivery once a rider is on the way."
        : `The ${opts.businessName} team will let you know when it's ready.`
      : `The ${opts.businessName} team will contact you shortly about delivery.`;
    const reply: Reply = {
      text: invoice
        ? `Thank you! Order ${ref(order)} is confirmed. Here's your invoice for ${formatNaira(order.totalKobo)}. ${next}`
        : payLine || spot
          ? `Thank you! Order ${ref(order)} is confirmed (total ${formatNaira(order.totalKobo)}). ${next}${payLine ? `\n\n${payLine}` : ""}`
          : `Thank you! Order ${ref(order)} is confirmed (total ${formatNaira(order.totalKobo)}). The ${opts.businessName} team will contact you shortly about payment${dispatch ? "" : " and delivery"}.`,
      ...(invoice ? { images: [invoice] } : {}),
    };
    const credit = opts.plan ? await opts.plan.credit() : null;
    if (credit) reply.text += `\n\n${credit}`;
    if (opts.ownerWaId) {
      const note = dispatch ? await dispatch.ownerNote(order) : null;
      reply.notify = [
        {
          to: opts.ownerWaId,
          text: [
            `New ${spot ? "walk-in " : ""}order ${ref(order)} from ${name ?? "a customer"} (+${waId})${spot?.table ? ` at ${spot.table}` : ""}:`,
            ...order.lines.map((l) => `• ${l.quantity} x ${l.name} = ${formatNaira(l.totalKobo)}`),
            ...(delivery ? [`• ${delivery.label} = ${formatNaira(delivery.feeKobo)}`] : []),
            `Total: ${formatNaira(order.totalKobo)}`,
            ...(note ? ["", note] : []),
            "",
            spot
              ? `It goes to your pickup screens once it's paid${payUrl ? " online" : `. If they pay at the counter, tap *Paid at counter* on the screen or reply *paid ${ref(order)}*`}.`
              : payUrl
                ? `They've been sent a link to pay online. I'll tell you when it's paid and send them a receipt. If they pay you another way, reply *paid ${ref(order)}*.`
                : `When they've paid, reply *paid ${ref(order)}* and I'll send them a receipt.`,
            ...(check.warning ? ["", check.warning] : []),
          ].join("\n"),
        },
      ];
    }
    return reply;
  }

  // Orders already out for delivery keep their fee on invoices and receipts
  // even if the plan later drops delivery; only new deliveries need the plan.
  async function deliveryOnPlan(): Promise<boolean> {
    return opts.features ? opts.features.has("delivery") : true;
  }

  async function documentsIncluded(): Promise<boolean> {
    return opts.features ? opts.features.has("invoices") : true;
  }

  /** Draws an invoice or receipt for an order. Returns null if drawing fails, so the chat carries on in text. */
  async function documentImage(
    kind: "invoice" | "receipt",
    order: Pick<OrderDetails, "orderNumber" | "lines" | "totalKobo" | "customerWaId" | "customerName" | "createdAt"> & { paidAt?: Date | null },
    delivery: DeliveryCharge | null,
    pickup: Pickup | null = null,
  ): Promise<OutgoingImage | null> {
    if (!(await documentsIncluded())) return null;
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
        ...(pickup ? { pickup } : {}),
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
    const catalogueReply = opts.catalogue ? await opts.catalogue.ownerCommand(msg, ctx) : null;
    if (catalogueReply) return catalogueReply;
    const walkInReply = opts.walkIn ? await opts.walkIn.ownerCommand(msg) : null;
    if (walkInReply) return walkInReply;
    const caption = (msg.caption ?? "").trim();
    if ((msg.type === "image" || msg.type === "document") && msg.mediaId) {
      if (!/^logo$/i.test(caption)) {
        return opts.branding
          ? {
              text:
                "To use this picture as the logo on your invoices and receipts, send it again with the caption *logo*." +
                (opts.catalogue ? " For a product photo, use the caption *photo* and the product's name, e.g. *photo T-shirts*." : ""),
            }
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
    if (opts.plan && /^(my )?(plan|upgrade)$/i.test(text)) {
      const messagesLine = opts.botMessages ? await opts.botMessages.summaryLine() : null;
      return { text: await opts.plan.summary(messagesLine ? [messagesLine] : []) };
    }
    if (opts.ordersLink && /^(my )?(orders|order board|board|sales|dashboard)$/i.test(text)) return { text: await ordersReply(opts.ordersLink) };
    if (opts.referral && /^(my )?(referral|refer|invite)( code)?$/i.test(text)) return { text: await opts.referral() };
    const upgrade = text.match(/^upgrade\s+(?:to\s+)?(.+)$/i);
    if (opts.plan?.upgrade && upgrade) return { text: await opts.plan.upgrade(upgrade[1]!, msg.from) };
    if (/^(logo|invoice|receipt|paid)$/i.test(text)) return { text: ownerHelp(opts.orderPrefix) };
    if (welcomeAsk(text) === "help" || /^menu$/i.test(text)) {
      return {
        text: ownerMenu({
          orderPrefix: opts.orderPrefix,
          ordersLink: !!opts.ordersLink,
          invoices: await documentsIncluded(),
          logo: !!opts.branding,
          catalogue: !!opts.catalogue && (opts.features ? await opts.features.has("catalogue") : true),
          plan: !!opts.plan,
          referral: !!opts.referral,
          delivery: !!opts.delivery && (await deliveryOnPlan()),
          walkIn: !!opts.walkIn && (opts.features ? await opts.features.has("walk_in") : true),
        }),
      };
    }
    const command = text.match(/^(invoice|receipt|paid)\s*#?\s*(?:[a-z]+\s*-?\s*)?(\d+)\.?$/i);
    if (!command) return null;

    const action = command[1]!.toLowerCase();
    const number = Number(command[2]);
    const label = `${opts.orderPrefix}-${number}`;
    const order = await opts.orders.findOrder(number);
    if (!order) return { text: `I can't find order ${label}. Please check the number.` };
    const delivery = opts.delivery ? await opts.delivery.charge(order.id) : null;

    if (action !== "paid" && !(await documentsIncluded())) {
      return { text: "Invoice and receipt pictures aren't on your plan. Send *plan* to see your options." };
    }

    if (action === "invoice") {
      const invoice = await documentImage("invoice", order, delivery);
      return invoice ? { text: `Invoice for ${label} (${formatNaira(order.totalKobo)}):`, images: [invoice] } : { text: DRAW_FAILED };
    }

    if (action === "receipt") {
      if (order.status !== "paid") return { text: `${label} isn't marked paid yet. Send *paid ${label}* once the customer has paid.` };
      const receipt = await documentImage("receipt", order, delivery, await walkInPickup(order));
      return receipt ? { text: `Receipt for ${label}:`, images: [receipt] } : { text: DRAW_FAILED };
    }

    // paid
    if (order.status === "cancelled") return { text: `${label} was cancelled, so I can't mark it paid.` };
    if (order.status === "paid") {
      const receipt = await documentImage("receipt", order, delivery, await walkInPickup(order));
      return {
        text: `${label} was already marked paid${order.paidAt ? ` on ${formatDocDate(order.paidAt)}` : ""}. Here's the receipt again:`,
        ...(receipt ? { images: [receipt] } : {}),
      };
    }
    if (!(await opts.orders.markPaid(order.id))) {
      return { text: `${label} has just been updated by another message. Send *receipt ${label}* to see where it stands.` };
    }
    const pickup = await walkInPaid(order);
    const receipt = await documentImage("receipt", { ...order, paidAt: new Date() }, delivery, pickup);
    const note = !pickup && opts.delivery && (await deliveryOnPlan()) ? await opts.delivery.ownerNote(order) : null;
    const who = order.customerName ?? showWaId(order.customerWaId);
    return {
      text:
        (receipt
          ? `✅ ${label} marked paid (${formatNaira(order.totalKobo)}). I've sent ${who} this receipt. If they haven't messaged in the last 24 hours WhatsApp may hold it back, so you can forward this copy.`
          : `✅ ${label} marked paid (${formatNaira(order.totalKobo)}). I've told ${who}${(await documentsIncluded()) ? ", but couldn't draw the receipt" : ""}.`) +
        (note ? `\n\n${note}` : ""),
      ...(receipt ? { images: [receipt] } : {}),
      notify: [receiptNote(order, label, receipt, pickup)],
    };
  }

  async function walkInPickup(order: SavedOrder): Promise<Pickup | null> {
    try {
      return opts.walkIn ? await opts.walkIn.pickup(order) : null;
    } catch (err) {
      log.error(`Couldn't read the pickup code for ${ref(order)}:`, err);
      return null;
    }
  }

  async function ordersReply(link: string): Promise<string> {
    if (opts.features && !(await opts.features.has("order_board")) && !(await opts.features.has("sales_dashboard"))) {
      return "The order board and sales dashboard come with Pro and above. Send *plan* to see how to upgrade.";
    }
    return `Your orders and sales: ${link}\n\nKeep this link to yourself: anyone who has it can see your orders.`;
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
