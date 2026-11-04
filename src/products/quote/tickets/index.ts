import { randomInt } from "node:crypto";
import type { Lang } from "../../../core/i18n.js";
import type { Notice, Reply } from "../../../core/product.js";
import type { OutgoingImage } from "../../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { PlanFeatures } from "../features.js";
import type { QuoteLine } from "../pricing.js";
import { renderTicketCard } from "./card.js";
import type { TicketLinks } from "./links.js";
import type { EventTicket, TicketStore } from "./store.js";

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
}

const MY_TICKETS = /^(?:(?:send|resend|show)\s+(?:me\s+)?)?(?:my|our)\s+tickets?[.!?]*$|^(?:renvoyer\s+)?(?:mes|nos)\s+billets[.!?]*$/i;

export function createEventTickets(opts: EventTicketOptions): EventTickets {
  const now = () => (opts.now ? opts.now() : new Date());
  const draw = opts.draw ?? renderTicketCard;
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
