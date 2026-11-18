import { randomInt } from "node:crypto";
import type { Lang } from "../../../core/i18n.js";
import { formatMoney, type Currency } from "../../../core/money.js";
import type { Notice, Reply } from "../../../core/product.js";
import type { OutgoingButtons, OutgoingImage } from "../../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import { priceFacts } from "../catalogue.js";
import type { PlanFeatures } from "../features.js";
import type { QuoteLine, Variant } from "../pricing.js";
import { renderTicketCard, renderTicketPoster } from "./card.js";
import type { TicketLinks } from "./links.js";
import type { EventTicket, TicketOption, TicketStore } from "./store.js";

// Event tickets (QUOTE_EVENT_TICKETS, migration 0068), on the plans that
// include event_tickets.
//
// 1. The owner adds the tickets to the price list like any product
//    ("Element House: Regular ₦10,000", "Element House: VIP ₦50,000") and
//    marks them with "ticket 3 on". Stock ("stock" command) caps how many sell.
// 2. Customers order them in the chat as usual. A tickets-only order skips
//    the delivery question, and the price comes from the price list.
// 3. Once paid (pay link, "paid EH-214", or the owner app), every ticket
//    bought gets its own picture with a QR code on WhatsApp, so a buyer can
//    forward one to each friend. "my tickets" sends them again.
// 4. Staff open the door screen ("door" sends its link) and scan each QR
//    code, or type "214 4827". A ticket gets in once; a second scan shows
//    when it was used.
//
// Customers who ask for tickets (or greet a shop that only sells tickets)
// get one message they swipe through: a card per ticket type with its picture
// (the product photo, or a drawn ticket stub), its price from the price list
// and a "Get your ticket" button, which quotes one of that ticket.
//
// Owner commands: tickets, ticket 3 on / ticket 3 off, door.

/** Tickets bought longer ago than this aren't resent by "my tickets". */
const RESEND_DAYS = 60;
/** The owner's "tickets" counts cover this many days. */
const COUNT_DAYS = 60;
/** Each ticket needs its own 4-digit code within an order, and its own picture on WhatsApp. */
const MAX_PER_ORDER = 500;

export interface EventTickets {
  /** Whether every line of this order is a ticket (no delivery to ask about). */
  ticketsOnly(lines: QuoteLine[]): Promise<boolean>;
  ownerCommand(msg: IncomingMessage): Promise<Reply | null>;
  /** "my tickets" from a customer: their unused tickets again. Null for anything else. */
  customerMessage(msg: IncomingMessage, contactId: string, lang: Lang): Promise<Reply | null>;
  /** Whether this message asks to see the tickets on sale ("tickets", "buy tickets"). */
  asksForTickets(text: string): boolean;
  /** Whether every product on the price list is a ticket, as for an event's own shop. */
  allTickets(variants: Variant[]): Promise<boolean>;
  /**
   * The ticket types on sale (narrowed to `only`'s variant ids when given) as
   * cards to swipe through, under `intro`. Null when none are on sale.
   */
  showcase(variants: Variant[], lang: Lang, only?: string[], intro?: string | null): Promise<Reply | null>;
  /** The ticket a "Get your ticket" tap is for, to quote one of it, and a line saying how to ask for more. Null for any other message. */
  tapped(text: string, variants: Variant[], lang: Lang): { variant: Variant; more: string } | null;
  /** Makes the tickets in a paid order and the message that sends them; null when it has none. */
  paid(order: { id: string; orderNumber: number; lines: QuoteLine[]; customerWaId: string; customerName: string | null }): Promise<Notice | null>;
}

export interface EventTicketOptions {
  businessId: string;
  businessName: string;
  orderPrefix: string;
  store: TicketStore;
  links: TicketLinks;
  features?: PlanFeatures;
  /** The language of the message that sends paid tickets (default English). */
  language?: Lang;
  now?: () => Date;
  /** Draws a ticket; renderTicketCard unless a test swaps it. */
  draw?: typeof renderTicketCard;
  /** What prices on the cards are in (default naira). */
  currency?: Currency;
  /** Loads a product photo for a ticket card; without it, every card gets a drawn ticket stub. */
  photo?(path: string): Promise<OutgoingImage | null>;
  /** Draws a ticket type's card picture; renderTicketPoster unless a test swaps it. */
  drawPoster?: typeof renderTicketPoster;
  log?: Pick<Console, "error">;
}

/** The most cards WhatsApp puts in one swipe message. */
const SWIPE_MAX = 10;
/** Starts the id of a card's button, which comes back as the customer's message: "Get my ticket: TEDx 28 Nov: VIP". */
const TAP = /^(?:Get my ticket|Je prends mon billet): (.+)$/i;
/** "Tickets", "buy tickets", "how much are your tickets?": the cards, not the AI. */
const ASK = /^(?:(?:can i |i want to |i'd like to )?(?:buy|get|book|see|show me|send)\s+)?(?:the |your |some |a |me )?(?:event )?(?:tickets?|billets?)(?:\s+(?:please|pls|price|prices))?[.!?]*$|^how much (?:are|is) (?:the |your )?tickets?[.!?]*$/i;

/**
 * How a ticket type reads on its card. The price list's default option name
 * ("Standard") is left off, and a product named like "Element House: VIP"
 * splits into the event and the ticket type.
 */
export function ticketLabel(productName: string, variantName: string): { title: string; event: string; type: string } {
  const option = variantName.startsWith(`${productName}: `) ? variantName.slice(productName.length + 2).trim() : "";
  if (option && !/^standard$/i.test(option)) return { title: `${productName}: ${option}`, event: productName, type: option };
  const split = productName.lastIndexOf(": ");
  if (split > 0) return { title: productName, event: productName.slice(0, split), type: productName.slice(split + 2) };
  return { title: productName, event: "", type: productName };
}

const MY_TICKETS = /^(?:(?:send|resend|show)\s+(?:me\s+)?)?(?:my|our)\s+tickets?[.!?]*$|^(?:renvoyer\s+)?(?:mes|nos)\s+billets[.!?]*$/i;

export function createEventTickets(opts: EventTicketOptions): EventTickets {
  const now = () => (opts.now ? opts.now() : new Date());
  const draw = opts.draw ?? renderTicketCard;
  const drawPoster = opts.drawPoster ?? renderTicketPoster;
  const money = (minor: number) => formatMoney(minor, opts.currency ?? "NGN");
  const log = opts.log ?? console;
  const onPlan = () => (opts.features ? opts.features.has("event_tickets") : Promise.resolve(true));
  const ref = (n: number) => `${opts.orderPrefix}-${n}`;
  const daysAgo = (days: number) => new Date(now().getTime() - days * 86_400_000);

  /** `perOrder`: how many tickets each order has, for "ticket 2 of 3". */
  function cards(tickets: EventTicket[], perOrder: Map<string, number>, lang: Lang): OutgoingImage[] {
    return tickets.map((t) => {
      const of = perOrder.get(t.orderId) ?? t.seat;
      return {
        data: draw({
          businessName: opts.businessName,
          name: t.name,
          holderName: t.holderName,
          qrText: opts.links.ticket(opts.businessId, t.id),
          code: `${ref(t.orderNumber)} · ${t.code}`,
          seat: t.seat,
          of,
          lang,
        }),
        mimeType: "image/jpeg",
        caption: `${t.name} · ${lang === "fr" ? `billet ${t.seat}/${of}` : `ticket ${t.seat} of ${of}`}`,
      };
    });
  }

  /** One ticket type's card: its picture, name, price and the button that quotes one. */
  async function saleCard(option: TicketOption, variant: Variant, priceKobo: number, lang: Lang): Promise<OutgoingButtons> {
    const fr = lang === "fr";
    const { title, event, type } = ticketLabel(option.productName, variant.name);
    const price = money(priceKobo);
    let image: OutgoingImage | null = null;
    if (option.photoPath && opts.photo) {
      try {
        image = await opts.photo(option.photoPath);
      } catch (err) {
        // The drawn stub stands in for a photo that won't load.
        log.error("Could not load a ticket photo:", err);
      }
    }
    image ??= { data: drawPoster({ businessName: opts.businessName, event, ticket: type, price }), mimeType: "image/jpeg" };
    const left = option.stock !== null && option.stock <= 20 ? (fr ? `Plus que ${option.stock} !` : `Only ${option.stock} left!`) : null;
    const about = option.description?.trim().split("\n")[0];
    return {
      image,
      body: [`*${title}*`, price, ...(left ? [left] : about ? [about] : [])].join("\n"),
      buttons: [fr ? { id: `Je prends mon billet: ${variant.name}`, title: "Obtenir mon billet" } : { id: `Get my ticket: ${variant.name}`, title: "Get your ticket" }],
    };
  }

  async function ticketList(): Promise<string> {
    const [products, counts] = await Promise.all([opts.store.products(), opts.store.counts(daysAgo(COUNT_DAYS))]);
    if (!products.length) return "Your price list is empty. Add your tickets to it first, e.g. Element House: VIP.";
    const sold = counts.length
      ? ["", "Sold in the last 60 days (let in / sold):", ...counts.map((c) => `• ${c.name}: ${c.checkedIn} / ${c.sold}`)]
      : [];
    return [
      "Your price list. Tickets are marked 🎟:",
      ...products.map((p, i) => `${i + 1}. ${p.name}${p.ticket ? " 🎟" : ""}`),
      ...sold,
      "",
      "Send *ticket 3 on* to sell product 3 as a ticket with a QR code, or *ticket 3 off* to stop. Send *door* for the check-in screen, and use *stock* to cap how many sell.",
    ].join("\n");
  }

  async function setTicket(number: number, on: boolean): Promise<string> {
    const product = (await opts.store.products())[number - 1];
    if (!product) return `There's no product ${number}. Send *tickets* to see the numbers.`;
    await opts.store.setTicket(product.id, on);
    return on
      ? `${product.name} is now a ticket 🎟 Each one paid for gets its own QR code on WhatsApp. Send *door* for the check-in screen.`
      : `${product.name} is no longer a ticket. Tickets already sold still get in.`;
  }

  return {
    async ticketsOnly(lines) {
      if (!lines.length || !(await onPlan())) return false;
      const tickets = await opts.store.ticketVariants([...new Set(lines.map((l) => l.variantId))]);
      return lines.every((l) => tickets.has(l.variantId));
    },

    asksForTickets: (text) => ASK.test(text.trim()),

    async allTickets(variants) {
      if (!variants.length || !(await onPlan())) return false;
      const tickets = await opts.store.ticketVariants(variants.map((v) => v.id));
      return variants.every((v) => tickets.has(v.id));
    },

    async showcase(variants, lang, only = [], intro) {
      if (!(await onPlan())) return null;
      const fr = lang === "fr";
      const byId = new Map(variants.map((v) => [v.id, v]));
      const wanted = new Set(only);
      const onSale = (await opts.store.onSale())
        .filter((o) => (wanted.size === 0 || wanted.has(o.variantId)) && o.stock !== 0)
        .flatMap((o) => {
          const variant = byId.get(o.variantId);
          const facts = variant && priceFacts(variant);
          return facts ? [{ option: o, variant, priceKobo: facts.unitKobo }] : [];
        })
        // Cheapest first, the way an event's tickets are usually listed.
        .sort((a, b) => a.priceKobo - b.priceKobo)
        .slice(0, SWIPE_MAX);
      if (!onSale.length) return null;
      const cards = await Promise.all(onSale.map((t) => saleCard(t.option, t.variant, t.priceKobo, lang)));

      const events = [...new Set(onSale.map((t) => ticketLabel(t.option.productName, t.variant.name).event || t.option.productName))];
      const about = onSale.find((t) => t.option.description?.trim())?.option.description?.trim();
      const pick = cards.length > 1
        ? fr ? "Faites glisser pour choisir votre billet, puis touchez *Obtenir mon billet*." : "Swipe to pick your ticket, then tap *Get your ticket*."
        : fr ? "Touchez *Obtenir mon billet* pour le vôtre." : "Tap *Get your ticket* for yours.";
      const body = [
        intro?.trim() || (fr ? `🎟 Billets pour *${events.join(", ")}*` : `🎟 Tickets for *${events.join(", ")}*`),
        ...(events.length === 1 && about ? [about] : []),
        pick,
      ].join("\n\n").slice(0, 1024);
      // WhatsApp needs two cards or more to swipe through; a single ticket type comes as one card.
      if (cards.length === 1) return { text: body, cards };
      return {
        text: "",
        cards,
        carousel: {
          body,
          cards: cards.map((c) => ({ image: c.image!, body: c.body, button: c.buttons[0]! })),
        },
      };
    },

    tapped(text, variants, lang) {
      const name = text.trim().match(TAP)?.[1]?.trim().toLowerCase();
      const variant = name ? variants.find((v) => v.name.toLowerCase() === name) : undefined;
      if (!variant) return null;
      const more = lang === "fr" ? "Vous venez à plusieurs ? Dites-moi combien de billets, par exemple *3 billets*." : "Coming with friends? Tell me how many tickets, e.g. *3 tickets*.";
      return { variant, more };
    },

    async ownerCommand(msg) {
      const text = (msg.text ?? "").trim();
      const list = /^(event )?tickets?$/i.test(text);
      const toggle = text.match(/^ticket\s+(\d{1,3})\s+(on|off)$/i);
      const door = /^(door|check[\s-]?in|door screen)$/i.test(text);
      if (!list && !toggle && !door) return null;
      if (!(await onPlan())) return { text: "Event tickets come with Starter and above. Send *plan* to see how to upgrade." };
      if (toggle) return { text: await setTicket(Number(toggle[1]), toggle[2]!.toLowerCase() === "on") };
      if (door) {
        return {
          text: `Your door screen: ${opts.links.door(opts.businessId)}\n\nOpen it on the phone at the door and tap *Scan QR* for each guest. Each ticket gets in once. Keep this link to your door staff.`,
        };
      }
      return { text: await ticketList() };
    },

    async customerMessage(msg, contactId, lang) {
      if (!MY_TICKETS.test((msg.text ?? "").trim()) || !(await onPlan())) return null;
      const tickets = await opts.store.unusedFor(contactId, daysAgo(RESEND_DAYS));
      if (!tickets.length) {
        return { text: lang === "fr" ? "Vous n'avez pas de billet non utilisé pour le moment." : "You don't have any unused tickets right now." };
      }
      const perOrder = new Map<string, number>();
      for (const id of new Set(tickets.map((t) => t.orderId))) perOrder.set(id, (await opts.store.forOrder(id)).length);
      return {
        text: lang === "fr" ? `Voici vos billets (${tickets.length}). Chaque code QR permet une entrée.` : `Here are your tickets (${tickets.length}). Each QR code lets one person in.`,
        images: cards(tickets, perOrder, lang),
      };
    },

    async paid(order) {
      if (!(await onPlan())) return null;
      const ticketVariants = await opts.store.ticketVariants([...new Set(order.lines.map((l) => l.variantId))]);
      const names = order.lines.filter((l) => ticketVariants.has(l.variantId)).flatMap((l) => Array<string>(l.quantity).fill(l.name));
      if (!names.length) return null;
      if (names.length > MAX_PER_ORDER) throw new Error(`Order ${ref(order.orderNumber)} has ${names.length} tickets, more than ${MAX_PER_ORDER}`);
      let tickets = await opts.store.forOrder(order.id);
      if (!tickets.length) {
        const codes = new Set<string>();
        while (codes.size < names.length) codes.add(String(randomInt(0, 10_000)).padStart(4, "0"));
        const pins = [...codes];
        tickets = await opts.store.issue(
          order.id,
          names.map((name, i) => ({ seat: i + 1, name, code: pins[i]! })),
        );
      }
      const lang = opts.language ?? "en";
      const count = tickets.length;
      return {
        to: order.customerWaId,
        text:
          lang === "fr"
            ? `Vos billets pour ${opts.businessName} (${count}) 🎟 Chaque code QR permet une entrée : transférez-en un à chaque invité. Envoyez *mes billets* pour les recevoir à nouveau.`
            : `Your ${count === 1 ? "ticket" : `${count} tickets`} for ${opts.businessName} 🎟 Each QR code lets one person in, so forward one to each guest. Send *my tickets* to get them again.`,
        images: cards(tickets, new Map([[order.id, count]]), lang),
      };
    },
  };
}
