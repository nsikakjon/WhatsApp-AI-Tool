import { formatNaira } from "../../../core/money.js";
import type { Notice, ProductContext, Reply } from "../../../core/product.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import { itemsAfterDiscount, type OrderDetails, type OrderStore, type SavedOrder } from "../store.js";
import { deliveryNotice, riderStep, type RiderStep, type TemplateName } from "./status.js";
import type { Delivery, DeliveryStore, Rider } from "./store.js";
import { mapLink, nigerianWaId, zoneForAddress, zoneForPin, type Zone } from "./zones.js";

// Delivery for the quote and order bot, with the business's own riders.
//
// 1. The customer replies YES to a quote. Before the order is placed, the bot
//    asks where to deliver: a location pin, a typed address, or PICKUP.
// 2. The fee comes from the business's delivery zones (zones.ts). When no zone
//    matches, the owner sets it with "fee KP-1001 2500". The customer sees the
//    fee as its own line and the new total, and confirms again.
// 3. Once the order is confirmed, the owner sends "rider KP-1001 Musa". Musa
//    gets the job with Picked up / Delivered / Couldn't deliver buttons and a
//    link to the rider page, which shares his location while it is open. The
//    customer gets a link to follow him on a map.
//
// WhatsApp doesn't pass live location on to bots (only one fixed pin), which
// is why tracking runs through the rider's page (tracking.ts).

export interface TrackingLinks {
  customer(d: Delivery): string;
  rider(d: Delivery): string;
}

export interface DispatchOptions {
  businessName: string;
  orderPrefix: string;
  ownerWaId?: string;
  /** Where riders collect orders: the address printed on invoices. */
  pickup?: string;
  /** Our WhatsApp number this business answers on (unset for the main number). */
  fromNumberId?: string;
  store: DeliveryStore;
  orders: OrderStore;
  links: TrackingLinks;
  /** Approved template for updates to people who haven't messaged in the last day. */
  template?: TemplateName;
}

export interface DeliveryCharge {
  /** e.g. "Delivery (Ikeja)" */
  label: string;
  feeKobo: number;
}

export interface Dispatch {
  /** Rider updates, the owner's delivery commands and the customer's address. Null for anything else. */
  handle(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null>;
  /** Asks where to deliver before a quote becomes an order. Null once that's settled. */
  beforeConfirm(order: SavedOrder, customer: { waId: string; name?: string }): Promise<Reply | null>;
  /** The delivery line on the invoice, already included in the order total. */
  charge(orderId: string): Promise<DeliveryCharge | null>;
  /** What the owner needs to know about delivering an order, and what to send next. */
  ownerNote(order: SavedOrder): Promise<string | null>;
}

const ORDER = String.raw`#?\s*(?:[a-z]+\s*-?\s*)?(\d+)`;
const PICKUP = /^(pick\s*-?\s*up|collect|i('|’)?ll (come|pick it up|collect)|self pick\s*-?\s*up)\b/i;
const NOT_AN_ADDRESS = /^(no|nope|cancel|stop|yes|ok|okay)\b/i;
const CHANGE = /^(change address|deliver instead)$/i;

export function createDispatch(opts: DispatchOptions): Dispatch {
  const { store } = opts;
  const ref = (orderNumber: number) => `${opts.orderPrefix}-${orderNumber}`;

  return {
    async handle(msg, ctx) {
      if (opts.ownerWaId && msg.from === opts.ownerWaId) {
        const reply = await ownerCommand(msg, ctx);
        if (reply) return reply;
      }
      const rider = await store.riderByWaId(msg.from);
      if (rider) {
        const reply = await riderMessage(rider, msg);
        if (reply) return reply;
      }
      return customerStep(msg, ctx);
    },

    async beforeConfirm(order, customer) {
      const d =
        (await store.forOrder(order.id)) ??
        (await store.start({
          orderId: order.id,
          orderRef: ref(order.orderNumber),
          businessName: opts.businessName,
          fromNumberId: opts.fromNumberId ?? null,
          ownerWaId: opts.ownerWaId ?? null,
          customerWaId: customer.waId,
          customerName: customer.name ?? null,
        }));
      if (d.status === "asking") return askForAddress();
      if (d.status === "needs_fee") {
        return { text: `${opts.businessName} is confirming the delivery fee to your address. You'll get the new total here shortly.` };
      }
      return null;
    },

    async charge(orderId) {
      const d = await store.forOrder(orderId);
      if (!d || d.feeKobo === null || d.status === "pickup" || d.status === "cancelled") return null;
      return { label: d.zoneName ? `Delivery (${d.zoneName})` : "Delivery", feeKobo: d.feeKobo };
    },

    async ownerNote(order) {
      const d = await store.forOrder(order.id);
      if (!d) return null;
      if (d.status === "pickup") return "The customer will collect it.";
      if (d.status !== "proposed" && d.status !== "failed") return null;
      return [`Deliver to: ${describe(d)}`, mapLink(d), "", await sendItOut(ref(order.orderNumber))].join("\n");
    },
  };

  async function sendItOut(label: string): Promise<string> {
    const riders = await store.riders();
    if (riders.length === 0) return `To send it out, add your rider first: *add rider Musa 0803 123 4567*, then *rider ${label} Musa*.`;
    return `To send it out, reply *rider ${label} ${riders[0]!.name}* (your riders: ${riders.map((r) => r.name).join(", ")}).`;
  }

  function askForAddress(): Reply {
    return {
      text: "",
      locationRequest:
        "Where should we deliver? Tap *Send location* to share a pin, or type the full address with the area (for example: 12 Allen Avenue, Ikeja). Reply *PICKUP* to collect it yourself.",
    };
  }

  async function customerStep(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
    const order = await opts.orders.latestOpenQuote(ctx.contactId);
    if (!order) return null;
    const d = await store.forOrder(order.id);
    if (!d) return null;
    const text = msg.text?.trim() ?? "";

    if (msg.location && ["asking", "needs_fee", "proposed", "pickup"].includes(d.status)) {
      const { latitude: lat, longitude: lng, name, address } = msg.location;
      const label = [name, address].filter(Boolean).join(", ") || null;
      return place(order, d, { address: label, lat, lng }, zoneForPin(await store.zones(), { lat, lng }));
    }
    if ((d.status === "proposed" || d.status === "pickup") && CHANGE.test(text)) {
      await store.update(d.id, ["proposed", "pickup"], { status: "asking" });
      return askForAddress();
    }
    if (d.status !== "asking" || !text) return null;

    if (PICKUP.test(text)) {
      const updated = await store.update(d.id, ["asking"], { status: "pickup", feeKobo: null, zoneName: null });
      if (!updated || !(await store.setQuoteTotal(order.id, itemsAfterDiscount(order)))) return null;
      return {
        text: [
          `No problem, you'll collect it${opts.pickup ? ` from:\n${opts.pickup}` : "."}`,
          "",
          `*Total: ${formatNaira(itemsAfterDiscount(order))}*`,
        ].join("\n"),
        buttons: {
          body: "Tap *Confirm order* to place it.",
          buttons: [
            { id: "yes", title: "Confirm order" },
            { id: "deliver instead", title: "Deliver instead" },
          ],
        },
      };
    }
    // Short replies and questions go to the normal chat, not into the address.
    if (text.length < 8 || text.endsWith("?") || NOT_AN_ADDRESS.test(text)) return null;
    return place(order, d, { address: text, lat: null, lng: null }, zoneForAddress(await store.zones(), text));
  }

  async function place(
    order: SavedOrder,
    d: Delivery,
    where: { address: string | null; lat: number | null; lng: number | null },
    zone: Zone | null,
  ): Promise<Reply | null> {
    const from: Delivery["status"][] = ["asking", "needs_fee", "proposed", "pickup"];
    const itemsKobo = itemsAfterDiscount(order);
    if (!zone) {
      const updated = await store.update(d.id, from, { ...where, status: "needs_fee", zoneName: null, feeKobo: null });
      if (!updated || !(await store.setQuoteTotal(order.id, itemsKobo))) return null;
      const label = ref(order.orderNumber);
      return {
        text: `Thanks! ${opts.businessName} will confirm the delivery fee to that address and send you the new total here.`,
        ...(opts.ownerWaId
          ? {
              notify: [
                {
                  to: opts.ownerWaId,
                  text: [
                    `${label}: ${d.customerName ?? "a customer"} (+${d.customerWaId}) wants delivery to ${describe(updated)}, which isn't in any of your delivery zones.`,
                    mapLink(updated),
                    "",
                    `Reply *fee ${label} 2500* with the delivery fee in naira (or *fee ${label} 0* for free delivery).`,
                  ].join("\n"),
                },
              ],
            }
          : {}),
      };
    }
    if (!(await store.setQuoteTotal(order.id, itemsKobo + zone.feeKobo))) return null;
    const updated = await store.update(d.id, from, { ...where, status: "proposed", zoneName: zone.name, feeKobo: zone.feeKobo });
    if (!updated) return null;
    return proposal(updated, itemsKobo);
  }

  function proposal(d: Delivery, itemsKobo: number): Reply {
    const fee = d.feeKobo ?? 0;
    return {
      text: [
        `Delivery to ${describe(d)}${d.zoneName ? ` (${d.zoneName})` : ""}: ${fee === 0 ? "free" : formatNaira(fee)}`,
        `Items: ${formatNaira(itemsKobo)}`,
        `*Total: ${formatNaira(itemsKobo + fee)}*`,
      ].join("\n"),
      buttons: {
        body: "Tap *Confirm order* to place it, or change the address.",
        buttons: [
          { id: "yes", title: "Confirm order" },
          { id: "change address", title: "Change address" },
        ],
      },
    };
  }

  async function ownerCommand(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
    const text = (msg.text ?? "").trim().replace(/\s+/g, " ");
    if (/^(delivery|deliveries|riders help)$/i.test(text)) return { text: ownerHelp(opts.orderPrefix) };
    if (/^riders$/i.test(text)) {
      const riders = await store.riders();
      return {
        text: riders.length
          ? ["Your riders:", ...riders.map((r) => `• ${r.name} (+${r.waId})`)].join("\n")
          : "You haven't added any riders yet. Send *add rider Musa 0803 123 4567*.",
      };
    }

    const add = text.match(/^add rider (.+?) (\+?[\d][\d -]{6,}\d)$/i);
    if (add) {
      const waId = nigerianWaId(add[2]!);
      if (!waId) return { text: "That doesn't look like a phone number. Try: *add rider Musa 0803 123 4567*" };
      const rider = await store.addRider(add[1]!.trim(), waId);
      return {
        text: `Added ${rider.name} (+${rider.waId}). Ask ${rider.name} to send *hi* to this WhatsApp number once, so WhatsApp lets my job messages through.`,
      };
    }
    const remove = text.match(/^remove rider (.+)$/i);
    if (remove) {
      return {
        text: (await store.removeRider(remove[1]!.trim()))
          ? `${remove[1]!.trim()} won't be offered for deliveries any more.`
          : `I can't find a rider called ${remove[1]!.trim()}. Send *riders* to see your list.`,
      };
    }

    const fee = text.match(new RegExp(`^fee ${ORDER} (?:₦|n|ngn)? ?([\\d,]+)$`, "i"));
    if (fee) return setFee(Number(fee[1]), Number(fee[2]!.replace(/,/g, "")));

    const rider = text.match(new RegExp(`^rider ${ORDER} (.+)$`, "i"));
    if (rider) return assign(Number(rider[1]), rider[2]!.trim(), ctx);

    const cancel = text.match(new RegExp(`^cancel delivery ${ORDER}$`, "i"));
    if (cancel) return cancelDelivery(Number(cancel[1]));

    return null;
  }

  /**
   * Finds an order and its delivery for an owner command, or says why not.
   * A quote that isn't an order yet only gets through when `quotes` is set.
   */
  async function lookup(orderNumber: number, quotes = false): Promise<{ order: OrderDetails; d: Delivery } | Reply> {
    const label = ref(orderNumber);
    const order = await opts.orders.findOrder(orderNumber);
    if (!order) return { text: `I can't find order ${label}. Please check the number.` };
    if (order.status === "quoted" && !quotes) return { text: `${label} hasn't been confirmed by the customer yet.` };
    const d = await store.forOrder(order.id);
    if (!d) return { text: `${label} has no delivery details. It was ordered before delivery was switched on, or the customer hasn't chosen yet.` };
    return { order, d };
  }

  async function setFee(orderNumber: number, naira: number): Promise<Reply> {
    const found = await lookup(orderNumber, true);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (order.status !== "quoted" || (d.status !== "needs_fee" && d.status !== "proposed")) {
      return { text: `${label} isn't waiting for a delivery fee, so I've left it as it is.` };
    }
    const feeKobo = naira * 100;
    const itemsKobo = itemsAfterDiscount(order);
    if (!(await store.setQuoteTotal(order.id, itemsKobo + feeKobo))) {
      return { text: `${label} has just been confirmed or cancelled, so I've left the fee as it was.` };
    }
    const updated = await store.update(d.id, ["needs_fee", "proposed"], { status: "proposed", feeKobo });
    if (!updated) return { text: `${label} has just changed. Send the fee again if it's still needed.` };
    const offer = proposal(updated, itemsKobo);
    return {
      text: `Sent ${updated.customerName ?? `+${updated.customerWaId}`} the delivery fee of ${formatNaira(feeKobo)} for ${label} (new total ${formatNaira(itemsKobo + feeKobo)}).`,
      notify: [{ to: updated.customerWaId, text: offer.text, buttons: offer.buttons }],
    };
  }

  async function assign(orderNumber: number, who: string, ctx: ProductContext): Promise<Reply> {
    const found = await lookup(orderNumber);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (order.status === "cancelled" || d.status === "cancelled") return { text: `${label} was cancelled.` };
    if (d.status === "pickup") return { text: `The customer is collecting ${label} themselves.` };
    if (d.status === "picked_up") return { text: `${d.riderName} has already picked up ${label}.` };
    if (d.status === "delivered") return { text: `${label} has already been delivered.` };

    const riders = await store.riders();
    const waId = nigerianWaId(who);
    const rider = riders.find((r) => r.name.toLowerCase() === who.toLowerCase() || (waId !== null && r.waId === waId));
    if (!rider) {
      return {
        text: `I don't know a rider called ${who}. Add them first: *add rider ${waId ? "Name" : who} ${waId ? who : "0803 123 4567"}*`,
      };
    }

    const previous = d.status === "assigned" && d.riderWaId && d.riderWaId !== rider.waId ? d.riderWaId : null;
    const updated = await store.update(d.id, ["proposed", "assigned", "failed"], { status: "assigned", rider });
    if (!updated) return { text: `${label} has just changed. Send *rider ${label} ${rider.name}* again if it still needs a rider.` };

    const job = jobText(updated, order);
    const notices: Notice[] = [
      {
        ...deliveryNotice(rider.waId, job, updated, opts.template),
        buttons: {
          body: `Tap when ${label} is picked up and when it's delivered.`,
          buttons: [
            { id: `picked ${label}`, title: "Picked up" },
            { id: `delivered ${label}`, title: "Delivered" },
            { id: `failed ${label}`, title: "Couldn't deliver" },
          ],
        },
      },
      deliveryNotice(
        updated.customerWaId,
        `${rider.name} will deliver your order ${label} from ${opts.businessName}. Follow it here: ${opts.links.customer(updated)}`,
        updated,
        opts.template,
      ),
    ];
    if (previous) {
      notices.push(deliveryNotice(previous, `${label} has gone to another rider, so you don't need to deliver it.`, updated, opts.template));
    }

    const lines = [`Sent ${label} to ${rider.name}. ${updated.customerName ?? "The customer"} has a link to follow the delivery.`];
    if (!opts.template && !(await ctx.canMessageFreely(rider.waId))) {
      lines.push(
        "",
        `⚠️ ${rider.name} hasn't messaged this number in the last 24 hours, so WhatsApp may not deliver the job. Ask ${rider.name} to send *hi* to this number, then send *rider ${label} ${rider.name}* again, or forward this:`,
        "",
        job,
      );
    }
    if (order.status !== "paid") {
      lines.push("", `${label} isn't marked paid yet. If ${rider.name} collects payment on delivery, reply *paid ${label}* once you have it.`);
    }
    return { text: lines.join("\n"), notify: notices };
  }

  function jobText(d: Delivery, order: OrderDetails): string {
    return [
      `New delivery ${d.orderRef} from ${opts.businessName}`,
      `Pick up: ${opts.pickup ?? opts.businessName}`,
      `Deliver to: ${describe(d)}`,
      `Map: ${mapLink(d)}`,
      `Customer: ${d.customerName ? `${d.customerName}, ` : ""}+${d.customerWaId}`,
      order.status === "paid"
        ? "Payment: already paid."
        : `Payment: not paid yet (${formatNaira(order.totalKobo)}). Check with ${opts.businessName} before you hand it over.`,
      "",
      "When you set off, open this link and keep it open so the customer can see you coming:",
      opts.links.rider(d),
    ].join("\n");
  }

  async function cancelDelivery(orderNumber: number): Promise<Reply> {
    const found = await lookup(orderNumber, true);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (d.status === "delivered") return { text: `${label} has already been delivered.` };
    const updated = await store.update(d.id, ["asking", "needs_fee", "proposed", "pickup", "assigned", "picked_up", "failed"], {
      status: "cancelled",
    });
    if (!updated) return { text: `${label}'s delivery was already cancelled.` };
    if (order.status === "quoted") await store.setQuoteTotal(order.id, itemsAfterDiscount(order));

    const notices: Notice[] = [
      deliveryNotice(updated.customerWaId, `The delivery of your order ${label} has been cancelled. ${opts.businessName} will contact you.`, updated, opts.template),
    ];
    if (updated.riderWaId && d.status !== "pickup") {
      const back = d.status === "picked_up" ? ` Please bring it back to ${opts.businessName}.` : "";
      notices.push(deliveryNotice(updated.riderWaId, `${label} is cancelled, so don't deliver it.${back}`, updated, opts.template));
    }
    const lines = [`Cancelled the delivery of ${label}. I've told the customer${updated.riderName && d.status !== "pickup" ? ` and ${updated.riderName}` : ""}.`];
    if (order.status === "paid") {
      lines.push("", `${label} was paid. If the customer should get money back, refund it from your Paystack dashboard (open the payment, then Refund) or by bank transfer.`);
    }
    return { text: lines.join("\n"), notify: notices };
  }

  async function riderMessage(rider: Rider, msg: IncomingMessage): Promise<Reply | null> {
    const text = (msg.text ?? "").trim();
    const step = text.match(new RegExp(`^(picked(?: up)?|delivered|failed|couldn'?t deliver)(?: ${ORDER})?$`, "i"));
    if (step) {
      const d = step[2] ? await jobByNumber(Number(step[2]), rider) : await store.activeForRider(rider.waId);
      if (!d) return { text: step[2] ? `${ref(Number(step[2]))} isn't one of your deliveries.` : "You don't have a delivery in progress." };
      const word = step[1]!.toLowerCase();
      const to: RiderStep = word.startsWith("picked") ? "picked_up" : word === "delivered" ? "delivered" : "failed";
      const moved = await riderStep(store, d, to, { trackingLink: opts.links.customer(d), template: opts.template });
      if (!moved) return { text: `${d.orderRef} is already marked ${statusWords(d.status)}.` };
      const thanks = { picked_up: "Thanks! The customer knows you're on the way.", delivered: "Thanks! Marked delivered.", failed: "Okay, I've told the business." }[to];
      return { text: `${d.orderRef}: ${thanks}`, notify: moved.notices };
    }

    if (msg.location || msg.type === "unsupported") {
      const d = await store.activeForRider(rider.waId);
      if (!d) return null;
      if (msg.location) {
        await store.setRiderPosition(d.id, msg.location.latitude, msg.location.longitude, new Date());
        return { text: `Got your location for ${d.orderRef}. For live updates, keep your rider page open: ${opts.links.rider(d)}` };
      }
      return { text: `WhatsApp doesn't pass live location on to me. To share where you are, open your rider page and keep it open: ${opts.links.rider(d)}` };
    }
    return null;
  }

  async function jobByNumber(orderNumber: number, rider: Rider): Promise<Delivery | null> {
    const order = await opts.orders.findOrder(orderNumber);
    const d = order ? await store.forOrder(order.id) : null;
    return d && d.riderWaId === rider.waId ? d : null;
  }
}

function describe(d: Pick<Delivery, "address" | "lat">): string {
  return d.address ?? (d.lat !== null ? "the pinned location" : "the address given");
}

function statusWords(status: Delivery["status"]): string {
  return { picked_up: "picked up", delivered: "delivered", failed: "not delivered", cancelled: "cancelled" }[status as string] ?? status;
}

function ownerHelp(prefix: string): string {
  return [
    "Delivery:",
    "• *add rider Musa 0803 123 4567* saves a rider. *riders* lists them, *remove rider Musa* takes one off.",
    `• *rider ${prefix}-1001 Musa* sends Musa the job and gives the customer a tracking link.`,
    `• *fee ${prefix}-1001 2500* sets the delivery fee (in naira) when an address isn't in your zones.`,
    `• *cancel delivery ${prefix}-1001* stops a delivery and tells the customer and rider.`,
    "Delivery zones and fees are set in the quote_delivery_zones table (see docs/DELIVERY.md).",
  ].join("\n");
}
