import { RATE, STARS } from "./ratings.js";
import type { OutgoingButtons } from "../../core/whatsapp/client.js";
import { aboutForAi, nextOpenText, openState, type BusinessAbout } from "./about.js";
import { guessLanguage, type Lang } from "../../core/i18n.js";
import { formatMoney, type Currency } from "../../core/money.js";
import { QUOTE_TEXTS, type QuoteTexts } from "./texts.js";
import { CREDIT_LINE } from "./plan.js";
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
  /** Saves a customer's rating for their own order (migration 0054). False when it isn't theirs or was rated already. */
  saveRating?(orderNumber: number, customerWaId: string, stars: number): Promise<boolean>;
  /** What the owner wrote about the business and its opening hours (migration 0054), read fresh every minute. */
  about?: () => Promise<BusinessAbout | null>;
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
  /** The language of the business's fixed messages (default English). Customers who write in the other language get theirs. */
  language?: Lang;
  /** What the price list is in (default naira). Amounts are always whole hundredths: kobo or centimes. */
  currency?: Currency;
  /** Who takes pay-link payments, named in the owner's "paid online" message (default Paystack). */
  payProvider?: string;
  log?: Pick<Console, "error">;
}

/** How an order was paid outside the owner's "paid KP-1001": online by pay link (with yarnOga's fee, in kobo), or at a walk-in counter. */
/** How an order was paid: by pay link, at a walk-in counter, or marked paid by staff in the owner app (e.g. a bank transfer). */
/** How an order was paid. Online, `courierKobo` is a Shipbubble courier's fee that came to yarnOga in the same payment. */
export type PaidVia = { how: "online"; feeKobo: number; courierKobo?: number } | { how: "counter" } | { how: "app" };

export interface QuoteProduct extends Product {
  /** Marks an order paid after Paystack confirmed its pay link (or staff took payment at the counter), and returns the receipt and owner messages. */
  orderPaid(orderNumber: number, via?: PaidVia): Promise<Notice[]>;
  /** The owner paid an order's courier fee by link: books the courier. */
  courierPaid(orderNumber: number): Promise<Notice[]>;
  /**
   * Reminder 1 or 2 for a confirmed order that isn't paid yet, with a fresh
   * pay link (or the bank details). Null when it no longer needs one.
   */
  paymentReminder(orderNumber: number, n: 1 | 2): Promise<string | null>;
  /** "How did we do with your order?" with Great / OK / Not good buttons. */
  ratingAsk(orderNumber: number): { text: string; buttons: OutgoingButtons };
}

const WALK_IN_OFF: WalkInMode = { on: false, paused: false };

export function createQuoteProduct(opts: QuoteProductOptions): QuoteProduct {
  const log = opts.log ?? console;
  const ref = (o: SavedOrder) => `${opts.orderPrefix}-${o.orderNumber}`;
  const draw = opts.renderDocument ?? renderDocument;
  const simpleAi = opts.simpleAi ?? createKeywordUnderstander();
  const businessLang: Lang = opts.language ?? "en";
  // Messages to the owner, and to customers outside a chat (receipts after an online payment), use the business's language.
  const own = QUOTE_TEXTS[businessLang];
  const money = (minor: number) => formatMoney(minor, opts.currency ?? "NGN");
  const credit = async (t: QuoteTexts) => {
    const line = opts.plan ? await opts.plan.credit() : null;
    return line === CREDIT_LINE ? t.poweredBy() : line;
  };

  return {
    name: "quote",
    async handle(msg, ctx): Promise<Reply> {
      // The customer's language for this reply: a quick guess first, then the AI's answer below.
      let lang: Lang = guessLanguage(msg.text) ?? businessLang;
      let t = QUOTE_TEXTS[lang];
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
        return { text: t.voiceNotOnLine() };
      }
      if (!msg.text) {
        return {
          text: msg.type === "audio" ? t.voiceUnclear() : t.sendRequest(),
        };
      }

      // A tap on a rating button: saved in code, no AI.
      const rate = msg.text.trim().match(RATE);
      if (rate && opts.saveRating && rate[1]!.toUpperCase().startsWith(`${opts.orderPrefix.toUpperCase()}-`)) {
        const orderNumber = Number(rate[1]!.split("-")[1]);
        const stars = Number(rate[2]);
        if (!(await opts.saveRating(orderNumber, msg.from, stars))) return { text: t.ratingAlready };
        const reply: Reply = { text: t.ratingThanks(stars, opts.businessName) };
        if (stars <= 1 && opts.ownerWaId) {
          reply.notify = [{ to: opts.ownerWaId, text: own.ownerLowRating(`${opts.orderPrefix}-${orderNumber}`, msg.contactName ?? own.aCustomer(), showWaId(msg.from)) }];
        }
        return reply;
      }

      if (opts.optOutOfFollowUps && isStopRequest(msg.text)) {
        await opts.optOutOfFollowUps(ctx.contactId);
        return { text: t.stopReminders() };
      }

      const variants = await opts.catalog.activeVariants();
      if (variants.length === 0) {
        return { text: t.noPriceList(opts.businessName) };
      }
      const welcome = await welcomeReply(msg, variants, walkIn, lang);
      if (welcome) return welcome;

      // A tap on "See more" under the product cards: no need for the AI.
      const page = msg.text.trim().match(CARDS_PAGE);
      if (page && opts.catalogue) {
        const cards = await opts.catalogue.cards(variants, Number(page[1]), undefined, lang);
        if (cards) return cards;
      }

      // Out of AI credits: simple menu replies instead, and the owner hears about it.
      const credit = opts.credits ? await opts.credits.spend() : { useAi: true, ownerNotice: null };
      const input = {
        text: msg.text,
        history: ctx.history,
        catalog: variants.map((v) => ({ id: v.id, name: v.name, minQuantity: v.minQuantity })),
        language: lang,
        about: aboutForAi(opts.about ? await opts.about() : null),
      };
      let understanding;
      let simple = !credit.useAi;
      try {
        understanding = await (simple ? simpleAi : opts.ai).understand(input);
      } catch (err) {
        log.error("Quote bot could not understand message:", err);
        // With plan features on, an AI outage falls back to the menu too.
        if (simple || !opts.credits) return { text: t.didntCatch() };
        simple = true;
        understanding = await simpleAi.understand(input);
      }

      // The AI says which language the customer wrote in; fixed messages follow it.
      if (understanding.language) {
        lang = understanding.language;
        t = QUOTE_TEXTS[lang];
      }

      let reply: Reply;
      switch (understanding.intent) {
        case "quote":
          reply = walkIn.paused ? closedReply(t) : await makeQuote(understanding.items, variants, ctx.contactId, msg.contactName, msg.from, t);
          break;
        case "confirm":
          reply = walkIn.paused ? closedReply(t) : await confirm(ctx.contactId, msg.contactName, msg.from, walkIn, t, lang);
          // Out of hours, the customer knows the order waits for opening time.
          if (!walkIn.on) await addClosedNote(reply, lang);
          break;
        case "cancel":
          reply = await cancel(ctx.contactId, t);
          break;
        case "catalogue":
          reply = (opts.catalogue && (await opts.catalogue.cards(variants, 1, understanding.show, lang))) || {
            text: (simple ? understanding.message : safeMessage(understanding.message)) ?? defaultHelp(variants, t),
          };
          break;
        default:
          // The simple replies are written in code, not by the AI, so they can list items freely.
          reply = { text: (simple ? understanding.message : safeMessage(understanding.message)) ?? defaultHelp(variants, t) };
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
        return toOwner(own.paidTwice(who, label, money(order.totalKobo), order.status === "cancelled"));
      }
      const pickup = await walkInPaid(order);
      const delivery = opts.delivery ? await opts.delivery.charge(order.id) : null;
      // The courier fee came with the payment: book the courier straight away.
      const booked = via.how === "online" && (via.courierKobo ?? 0) > 0 && opts.delivery ? await opts.delivery.bookCourier(orderNumber) : [];
      const receipt = await documentImage("receipt", { ...order, paidAt: new Date() }, delivery, pickup, own);
      const note = !pickup && opts.delivery && (await deliveryOnPlan()) ? await opts.delivery.ownerNote(order) : null;
      const total = money(order.totalKobo);
      const how =
        via.how === "counter"
          ? own.paidCounter(label, total, who)
          : via.how === "app"
            ? own.paidApp(label, total, who)
            : own.paidOnline(label, total, who, via.feeKobo > 0 ? money(via.feeKobo) : null, opts.payProvider ?? "Paystack");
      return [
        receiptNote(order, label, receipt, pickup, own),
        ...toOwner(how + (pickup ? `\n\n${own.onPickupScreens(pickup.stations)}` : "") + (note ? `\n\n${note}` : "")),
        ...booked,
      ];
    },

    async courierPaid(orderNumber) {
      return opts.delivery ? opts.delivery.bookCourier(orderNumber) : [];
    },

    ratingAsk(orderNumber) {
      const label = `${opts.orderPrefix}-${orderNumber}`;
      const b = own.ratingButtons;
      return {
        text: "",
        buttons: {
          body: own.ratingAsk(opts.businessName, label),
          buttons: [
            { id: `rate ${label} ${STARS.great}`, title: b.great },
            { id: `rate ${label} ${STARS.ok}`, title: b.ok },
            { id: `rate ${label} ${STARS.bad}`, title: b.bad },
          ],
        },
      };
    },

    async paymentReminder(orderNumber, n) {
      const order = await opts.orders.findOrder(orderNumber);
      if (!order || order.status !== "confirmed") return null;
      const url = await payLinkFor(order, order.customerWaId);
      const how = url ? own.payLine(url, opts.currency ?? "NGN") : opts.paymentDetails ? opts.paymentDetails : null;
      return own.payReminder(n, opts.businessName, ref(order), money(order.totalKobo), how);
    },
  };

  async function welcomeReply(msg: IncomingMessage, variants: Variant[], walkIn: WalkInMode, lang: Lang): Promise<Reply | null> {
    const text = msg.text!.trim();
    const t = QUOTE_TEXTS[lang];
    if (text.toLowerCase() === QUOTE_CHOICE) return { text: defaultHelp(variants, t) };
    if (text.toLowerCase() === TEAM_CHOICE && opts.ownerWaId) {
      const closed = await closedNote(lang);
      return {
        text: closed ? `${t.teamNotified(opts.businessName)}\n\n${closed}` : t.teamNotified(opts.businessName),
        notify: [{ to: opts.ownerWaId, text: own.talkRequest(msg.contactName ?? own.aCustomer(), showWaId(msg.from)) }],
      };
    }
    const ask = welcomeAsk(text);
    if (!ask) return null;
    if (ask === "catalogue" && opts.catalogue) {
      const cards = await opts.catalogue.cards(variants, 1, undefined, lang);
      if (cards) return cards;
    }
    const reply = customerWelcome({
      lang,
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
      reply.buttons.body += `\n\n${own.ownerHint()}`;
    } else if (reply.buttons && !walkIn.on) {
      const closed = await closedNote(lang);
      if (closed) reply.buttons.body += `\n\n${closed}`;
    }
    return reply;
  }

  /** "We're closed right now and open again tomorrow at 08:00", or null when open or no hours are set. */
  async function closedNote(lang: Lang): Promise<string | null> {
    const about = opts.about ? await opts.about() : null;
    const state = openState(about?.hours ?? null, new Date());
    if (!state || state.open) return null;
    return QUOTE_TEXTS[lang].closedNow(state.next ? nextOpenText(state.next, lang) : null);
  }

  async function addClosedNote(reply: Reply, lang: Lang): Promise<void> {
    const closed = await closedNote(lang);
    if (closed) reply.text = reply.text ? `${reply.text}\n\n${closed}` : closed;
  }

  function receiptNote(order: OrderDetails, label: string, receipt: OutgoingImage | null, pickup: Pickup | null, t: QuoteTexts): Notice {
    const thanks = t.paymentThanks(label, money(order.totalKobo), opts.businessName);
    if (pickup) {
      const where = pickup.table ? t.pickupAtTable(pickup.table) : t.pickupWhenReady();
      return {
        to: order.customerWaId,
        text: `${thanks} ${where} ${receipt ? t.pickupShowQr() : t.pickupShowCode(pickup.code)}`,
        ...(receipt ? { images: [receipt] } : {}),
      };
    }
    return {
      to: order.customerWaId,
      text: `${thanks}${receipt ? ` ${t.hereIsReceipt()}` : ""}`,
      ...(receipt ? { images: [receipt] } : {}),
    };
  }

  function closedReply(t: QuoteTexts): Reply {
    return { text: t.closed(opts.businessName) };
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
    t: QuoteTexts,
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
        problems.push(t.minimum(variant.name, result.minQuantity));
      else manual.push(`${item.quantity} x ${variant.name}`);
    }

    if (opts.catalogue && lines.length > 0) {
      const short = await opts.catalogue.shortages(lines, t === QUOTE_TEXTS.fr ? "fr" : "en");
      problems.push(...short.values());
      lines = lines.filter((l) => !short.has(l.variantId));
    }

    // Hand items without a set price to the owner instead of guessing.
    const manualNote = manual.length > 0 ? t.teamWillPrice(manual.join(", ")) : null;
    const notify =
      manual.length > 0 && opts.ownerWaId
        ? [
            {
              to: opts.ownerWaId,
              text: [own.manualQuote(name ?? own.aCustomer(), `+${waId}`), ...manual.map((m) => `• ${m}`)].join("\n"),
            },
          ]
        : undefined;

    if (lines.length === 0) {
      const text = [...problems, ...(manualNote ? [t.thanks(manualNote)] : [])].join("\n") || defaultHelp(variants, t);
      return notify ? { text, notify } : { text };
    }

    const order = await opts.orders.createQuote(contactId, lines, quoteTotal(lines));
    const creditLine = await credit(t);
    const text = [
      t.quoteHeader(ref(order)),
      "",
      ...lines.map((l) => `• ${l.quantity} x ${l.name} @ ${money(l.unitPriceKobo)} = ${money(l.totalKobo)}`),
      "",
      t.quoteTotal(money(order.totalKobo)),
      ...(problems.length > 0 ? ["", ...problems] : []),
      ...(manualNote ? ["", manualNote] : []),
      "",
      t.replyYes(),
      ...(creditLine ? ["", creditLine] : []),
    ].join("\n");
    const photos = opts.catalogue ? await opts.catalogue.photos(lines) : [];
    return { text, ...(photos.length ? { images: photos } : {}), ...(notify ? { notify } : {}) };
  }

  async function confirm(
    contactId: string,
    name: string | undefined,
    waId: string,
    walkIn: WalkInMode,
    t: QuoteTexts,
    lang: Lang,
  ): Promise<Reply> {
    const order = await opts.orders.latestOpenQuote(contactId);
    const noQuote = { text: t.noQuoteWaiting() };
    if (!order) return noQuote;

    // Over the plan's monthly limit: the quote stays open and the owner takes
    // it from here, so the sale isn't lost.
    const check = opts.plan ? await opts.plan.checkOrder() : ({ allowed: true, warning: null } as const);
    if (!check.allowed) {
      return {
        text: t.overLimitCustomer(opts.businessName, ref(order), money(order.totalKobo)),
        ...(opts.ownerWaId
          ? {
              notify: [
                {
                  to: opts.ownerWaId,
                  text: [
                    own.wantsToOrder(name ?? own.aCustomer(), `+${waId}`, ref(order)),
                    ...order.lines.map((l) => `• ${l.quantity} x ${l.name} = ${money(l.totalKobo)}`),
                    own.total(money(order.totalKobo)),
                    "",
                    own.overLimitOwner(check.limit, check.planName, ref(order)),
                  ].join("\n"),
                },
              ],
            }
          : {}),
      };
    }

    const dispatch = !walkIn.on && opts.delivery && (await deliveryOnPlan()) ? opts.delivery : undefined;
    if (dispatch) {
      const ask = await dispatch.beforeConfirm(order, { waId, name }, lang);
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
    const invoice = await documentImage("invoice", { ...order, customerWaId: waId, customerName: name ?? null, createdAt: new Date() }, delivery, null, t, lang);
    const payUrl = await payLinkFor(order, waId);
    const payLine = payUrl ? t.payLine(payUrl, opts.currency ?? "NGN") : null;
    if (invoice && payLine) invoice.caption = `${invoice.caption}\n\n${payLine}`;
    const next = spot
      ? payUrl
        ? t.nextWalkInLink()
        : t.nextWalkInCounter(ref(order))
      : dispatch
      ? delivery
        ? t.nextDeliveryLink()
        : t.nextReady(opts.businessName)
      : t.nextContactDelivery(opts.businessName);
    const total = money(order.totalKobo);
    const reply: Reply = {
      text: invoice
        ? t.confirmedInvoice(ref(order), total, next)
        : payLine || spot
          ? `${t.confirmedTotal(ref(order), total, next)}${payLine ? `\n\n${payLine}` : ""}`
          : t.confirmedContact(ref(order), total, opts.businessName, !dispatch),
      ...(invoice ? { images: [invoice] } : {}),
    };
    const creditLine = await credit(t);
    if (creditLine) reply.text += `\n\n${creditLine}`;
    if (opts.ownerWaId) {
      const note = dispatch ? await dispatch.ownerNote(order) : null;
      reply.notify = [
        {
          to: opts.ownerWaId,
          text: [
            own.newOrder(!!spot, ref(order), name ?? own.aCustomer(), `+${waId}`, spot?.table ?? null),
            ...order.lines.map((l) => `• ${l.quantity} x ${l.name} = ${money(l.totalKobo)}`),
            ...(delivery ? [`• ${delivery.label} = ${money(delivery.feeKobo)}`] : []),
            own.total(money(order.totalKobo)),
            ...(note ? ["", note] : []),
            "",
            spot ? own.walkInScreensNote(!!payUrl, ref(order)) : payUrl ? own.payLinkSentNote(ref(order)) : own.replyPaidNote(ref(order)),
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
    t: QuoteTexts = own,
    lang: Lang = businessLang,
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
        lang,
        currency: opts.currency ?? "NGN",
      });
      const label = kind === "invoice" ? t.invoice() : t.receipt();
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
        return opts.branding ? { text: own.logoHint(!!opts.catalogue) } : null;
      }
      if (!opts.branding) return { text: own.logoCantSave() };
      const file = await ctx.downloadMedia(msg.mediaId);
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimeType)) {
        return { text: own.logoFormat() };
      }
      await opts.branding.saveLogo(new Uint8Array(await file.data.arrayBuffer()), file.mimeType);
      return { text: own.logoSaved() };
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
    if (/^(logo|invoice|receipt|paid)$/i.test(text)) return { text: own.ownerHelp(opts.orderPrefix) };
    if (welcomeAsk(text) === "help" || /^menu$/i.test(text)) {
      return {
        text: ownerMenu({
          lang: businessLang,
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
    if (!order) return { text: own.cantFind(label) };
    const delivery = opts.delivery ? await opts.delivery.charge(order.id) : null;

    if (action !== "paid" && !(await documentsIncluded())) {
      return { text: own.noDocuments() };
    }

    if (action === "invoice") {
      const invoice = await documentImage("invoice", order, delivery);
      return invoice ? { text: own.invoiceFor(label, money(order.totalKobo)), images: [invoice] } : { text: own.drawFailed() };
    }

    if (action === "receipt") {
      if (order.status !== "paid") return { text: own.notPaidYet(label) };
      const receipt = await documentImage("receipt", order, delivery, await walkInPickup(order));
      return receipt ? { text: own.receiptFor(label), images: [receipt] } : { text: own.drawFailed() };
    }

    // paid
    if (order.status === "cancelled") return { text: own.cancelledCantPay(label) };
    if (order.status === "paid") {
      const receipt = await documentImage("receipt", order, delivery, await walkInPickup(order));
      return {
        text: own.alreadyPaid(label, order.paidAt ? formatDocDate(order.paidAt, businessLang) : null),
        ...(receipt ? { images: [receipt] } : {}),
      };
    }
    if (!(await opts.orders.markPaid(order.id))) {
      return { text: own.justUpdated(label) };
    }
    const pickup = await walkInPaid(order);
    const receipt = await documentImage("receipt", { ...order, paidAt: new Date() }, delivery, pickup);
    const note = !pickup && opts.delivery && (await deliveryOnPlan()) ? await opts.delivery.ownerNote(order) : null;
    const who = order.customerName ?? showWaId(order.customerWaId);
    return {
      text:
        (receipt
          ? own.markedPaidSent(label, money(order.totalKobo), who)
          : own.markedPaidTold(label, money(order.totalKobo), who, await documentsIncluded())) +
        (note ? `\n\n${note}` : ""),
      ...(receipt ? { images: [receipt] } : {}),
      notify: [receiptNote(order, label, receipt, pickup, own)],
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
      return own.boardNotOnPlan();
    }
    return own.boardLink(link);
  }

  async function cancel(contactId: string, t: QuoteTexts): Promise<Reply> {
    const order = await opts.orders.latestOpenQuote(contactId);
    if (!order) return { text: t.noProblem() };
    await opts.orders.setStatus(order.id, "cancelled");
    return { text: t.cancelledQuote(ref(order)) };
  }
}

function defaultHelp(variants: Variant[], t: QuoteTexts): string {
  const names = [...new Set(variants.map((v) => v.name.split(":")[0]!.trim()))];
  return t.defaultHelp(names.join(", "));
}

// Anything that looks like money, in English or French. The AI is told never
// to mention prices; this is the safety net that keeps a model-made amount
// from reaching a customer.
const MONEY =
  /₦|naira|\bngn\b|kobo|\bN\s?\d|\d\s*k\b|\bprice (is|of)\b|\bcosts?\b|\btotal\b|\d{1,3}(,\d{3})+|fcfa|\bcfa\b|\bxof\b|\bxaf\b|francs?\b|\d\s*f\b|\bprix (est|de)\b|co[uû]te|\d{1,3}([ .\u00a0\u202f]\d{3})+/i;

export function safeMessage(message: string | null): string | null {
  if (!message || !message.trim()) return null;
  return MONEY.test(message) ? null : message.trim();
}
