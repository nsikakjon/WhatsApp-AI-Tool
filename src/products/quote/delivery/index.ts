import { guessLanguage, type Lang } from "../../../core/i18n.js";
import { currencyName, formatMoney, type Currency } from "../../../core/money.js";
import type { Notice, ProductContext, Reply } from "../../../core/product.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import { itemsAfterDiscount, type OrderDetails, type OrderStore, type SavedOrder } from "../store.js";
import { deliveryNotice, riderStep, type RiderStep, type TemplateName } from "./status.js";
import type { Delivery, DeliveryStore, Rider } from "./store.js";
import { mapLink, nigerianWaId, zoneForAddress, zoneForPin, type Zone } from "./zones.js";
import { showWaId } from "../../../core/whatsapp/ids.js";
import { DELIVERY_TEXTS } from "./texts.js";
import type { CourierParty, CourierService } from "./shipbubble.js";

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
  customer(d: Pick<Delivery, "id">): string;
  rider(d: Pick<Delivery, "id">): string;
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
  /** The business's language and currency (English and naira when unset). */
  language?: Lang;
  currency?: Currency;
  /** Where online payments are refunded, for the owner's note. */
  payProvider?: string;
  /**
   * Shipbubble couriers (naira businesses only) for addresses outside the
   * business's zones. `from` is the shop, where the courier collects.
   * `payLink` makes a link for the owner to pay the courier fee when the
   * customer paid them directly; the courier is booked once that's paid.
   */
  courier?: {
    service: CourierService;
    from: CourierParty;
    payLink?(order: OrderDetails, feeKobo: number): Promise<string>;
  };
}

export interface DeliveryCharge {
  /** e.g. "Delivery (Ikeja)" */
  label: string;
  feeKobo: number;
  /** A Shipbubble courier's fee, which goes to yarnOga to pay the courier rather than to the business. */
  courier?: boolean;
}

export interface Dispatch {
  /** Rider updates, the owner's delivery commands and the customer's address. Null for anything else. */
  handle(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null>;
  /** Asks where to deliver before a quote becomes an order. Null once that's settled. */
  beforeConfirm(order: SavedOrder, customer: { waId: string; name?: string }, lang?: Lang): Promise<Reply | null>;
  /** The delivery line on the invoice, already included in the order total. */
  charge(orderId: string): Promise<DeliveryCharge | null>;
  /** What the owner needs to know about delivering an order, and what to send next. */
  ownerNote(order: SavedOrder): Promise<string | null>;
  /**
   * The courier fee has reached yarnOga (in a pay link, or paid by the owner):
   * books the courier and returns who to tell. Booking twice is prevented.
   */
  bookCourier(orderNumber: number): Promise<Notice[]>;
}

const ORDER = String.raw`#?\s*(?:[a-z]+\s*-?\s*)?(\d+)`;
const PICKUP = /^(pick\s*-?\s*up|collect|i('|’)?ll (come|pick it up|collect)|self pick\s*-?\s*up|retrait|je (viens|passe|vais venir) (le |la )?(chercher|récupérer|prendre)|à emporter)(?![\p{L}])/iu;
const NOT_AN_ADDRESS = /^(no|nope|cancel|stop|yes|ok|okay|non|annuler|oui|d'accord|merci)\b/i;
const CHANGE = /^(change address|deliver instead|changer l'adresse|plutôt livrer)$/i;

export function createDispatch(opts: DispatchOptions): Dispatch {
  const { store } = opts;
  const ref = (orderNumber: number) => `${opts.orderPrefix}-${orderNumber}`;
  const businessLang = opts.language ?? "en";
  // Owner and rider messages use the business's language.
  const t = DELIVERY_TEXTS[businessLang];
  const money = (minor: number) => formatMoney(minor, opts.currency ?? "NGN");
  const describe = (d: Pick<Delivery, "address" | "lat">, w = t) => d.address ?? (d.lat !== null ? w.pinnedLocation : w.addressGiven);

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

    async beforeConfirm(order, customer, lang = businessLang) {
      const c = DELIVERY_TEXTS[lang];
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
      if (d.status === "asking") return askForAddress(c);
      if (d.status === "needs_fee") return { text: c.confirmingFee(opts.businessName) };
      return null;
    },

    async charge(orderId) {
      const d = await store.forOrder(orderId);
      if (!d || d.feeKobo === null || d.status === "pickup" || d.status === "cancelled") return null;
      if (d.courier) return { label: t.courierLine(d.courier.name), feeKobo: d.feeKobo, courier: true };
      return { label: t.deliveryLine(d.zoneName), feeKobo: d.feeKobo };
    },

    async ownerNote(order) {
      const d = await store.forOrder(order.id);
      if (!d) return null;
      if (d.status === "pickup") return t.customerCollects;
      if (d.status !== "proposed" && d.status !== "failed") return null;
      const label = ref(order.orderNumber);
      if (d.courier && !d.courier.orderId && d.status === "proposed") {
        return [t.deliverTo(describe(d)), "", t.courierToPay(label, d.courier.name, money(d.feeKobo ?? 0))].join("\n");
      }
      return [t.deliverTo(describe(d)), mapLink(d), "", await sendItOut(label)].join("\n");
    },

    async bookCourier(orderNumber) {
      const label = ref(orderNumber);
      const order = await opts.orders.findOrder(orderNumber);
      const d = order ? await store.forOrder(order.id) : null;
      const toOwner = (text: string): Notice[] => (opts.ownerWaId ? [{ to: opts.ownerWaId, text }] : []);
      if (!order || !d?.courier || !opts.courier) return toOwner(t.courierNotFound(label));
      if (d.courier.orderId || d.status !== "proposed") return [];
      let booking;
      try {
        booking = await opts.courier.service.book(d.courier);
      } catch (err) {
        // The fee is already with yarnOga, so the owner and yarnOga both hear about it (errors reach Jay's alerts).
        console.error(`Courier booking for ${label} (${opts.businessName}) failed after the fee was paid:`, err);
        return toOwner(t.courierBookFailed(label, d.courier.name, (err as Error).message));
      }
      const courier = { ...d.courier, orderId: booking.orderId, trackingUrl: booking.trackingUrl, phone: booking.courierPhone, name: booking.courierName || d.courier.name };
      const updated = await store.update(d.id, ["proposed"], { status: "assigned", courier });
      if (!updated) return [];
      return [
        deliveryNotice(updated.customerWaId, t.courierComing(courier.name, label, opts.businessName, courier.trackingUrl), updated, opts.template),
        ...toOwner(t.courierBooked(label, courier.name, courier.phone, courier.pickupEta, opts.courier.from.address)),
      ];
    },
  };

  async function sendItOut(label: string): Promise<string> {
    const riders = await store.riders();
    if (riders.length === 0) return t.addRiderFirst(label);
    return t.replyRider(label, riders[0]!.name, riders.map((r) => r.name).join(", "));
  }

  function askForAddress(c = t): Reply {
    return { text: "", locationRequest: c.askAddress };
  }

  async function customerStep(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
    const order = await opts.orders.latestOpenQuote(ctx.contactId);
    if (!order) return null;
    const d = await store.forOrder(order.id);
    if (!d) return null;
    const text = msg.text?.trim() ?? "";
    const c = DELIVERY_TEXTS[guessLanguage(text) ?? businessLang];

    if (msg.location && ["asking", "needs_fee", "proposed", "pickup"].includes(d.status)) {
      const { latitude: lat, longitude: lng, name, address } = msg.location;
      const label = [name, address].filter(Boolean).join(", ") || null;
      return chosen(await place(order, d, { address: label, lat, lng }, zoneForPin(await store.zones(), { lat, lng }), c));
    }
    if ((d.status === "proposed" || d.status === "pickup") && CHANGE.test(text)) {
      await store.update(d.id, ["proposed", "pickup"], { status: "asking" });
      return askForAddress(c);
    }
    if (d.status !== "asking" || !text) return null;

    if (PICKUP.test(text)) {
      const updated = await store.update(d.id, ["asking"], { status: "pickup", feeKobo: null, zoneName: null });
      if (!updated || !(await store.setQuoteTotal(order.id, itemsAfterDiscount(order)))) return null;
      return chosen({
        text: [c.collectFrom(opts.pickup), "", c.total(money(itemsAfterDiscount(order)))].join("\n"),
        buttons: {
          body: c.tapConfirm,
          buttons: [
            { id: "yes", title: c.confirmOrder },
            { id: "deliver instead", title: c.deliverInstead },
          ],
        },
      });
    }
    // Short replies and questions go to the normal chat, not into the address.
    if (text.length < 8 || text.endsWith("?") || NOT_AN_ADDRESS.test(text)) return null;
    return chosen(await place(order, d, { address: text, lat: null, lng: null }, zoneForAddress(await store.zones(), text), c));
  }

  /** The customer has just picked delivery or pickup (the demo shop asks them to sign up here). */
  function chosen(reply: Reply | null): Reply | null {
    return reply && { ...reply, stage: "delivery_chosen" };
  }

  async function place(
    order: SavedOrder,
    d: Delivery,
    where: { address: string | null; lat: number | null; lng: number | null },
    zone: Zone | null,
    c = t,
  ): Promise<Reply | null> {
    const from: Delivery["status"][] = ["asking", "needs_fee", "proposed", "pickup"];
    const itemsKobo = itemsAfterDiscount(order);
    if (!zone && opts.courier) {
      const offer = await courierOffer(order, d, where);
      if (offer) {
        if (!(await store.setQuoteTotal(order.id, itemsKobo + offer.feeKobo))) return null;
        const updated = await store.update(d.id, from, { ...where, status: "proposed", zoneName: null, feeKobo: offer.feeKobo, courier: offer.courier });
        if (!updated) return null;
        return proposal(updated, itemsKobo, c);
      }
    }
    if (!zone) {
      const updated = await store.update(d.id, from, { ...where, status: "needs_fee", zoneName: null, feeKobo: null });
      if (!updated || !(await store.setQuoteTotal(order.id, itemsKobo))) return null;
      const label = ref(order.orderNumber);
      return {
        text: c.willConfirmFee(opts.businessName),
        ...(opts.ownerWaId
          ? {
              notify: [
                {
                  to: opts.ownerWaId,
                  text: [
                    t.outsideZones(label, d.customerName ?? t.aCustomer, d.customerWaId, describe(updated)),
                    mapLink(updated),
                    "",
                    t.replyFee(label, currencyName(opts.currency ?? "NGN", businessLang)),
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
    return proposal(updated, itemsKobo, c);
  }

  /** The cheapest Shipbubble courier for this address, or null to fall back to the owner pricing it. */
  async function courierOffer(
    order: SavedOrder,
    d: Delivery,
    where: { address: string | null; lat: number | null; lng: number | null },
  ): Promise<{ feeKobo: number; courier: NonNullable<Delivery["courier"]> } | null> {
    try {
      const quote = await opts.courier!.service.quote(
        opts.courier!.from,
        { name: d.customerName ?? "Customer", phone: d.customerWaId, address: where.address ?? `${where.lat},${where.lng}`, lat: where.lat, lng: where.lng },
        order.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitKobo: l.unitPriceKobo })),
      );
      if (!quote) return null;
      return {
        feeKobo: quote.feeKobo,
        courier: {
          name: quote.courierName,
          courierId: quote.courierId,
          serviceCode: quote.serviceCode,
          requestToken: quote.requestToken,
          pickupEta: quote.pickupEta,
          deliveryEta: quote.deliveryEta,
        },
      };
    } catch (err) {
      console.error(`Courier price for ${ref(order.orderNumber)} failed; the owner will price it:`, err);
      return null;
    }
  }

  function proposal(d: Delivery, itemsKobo: number, c = t): Reply {
    const fee = d.feeKobo ?? 0;
    return {
      text: [
        d.courier ? c.courierOffer(describe(d, c), d.courier.name, d.courier.deliveryEta, money(fee)) : c.deliveryTo(describe(d, c), d.zoneName, fee === 0 ? null : money(fee)),
        c.items(money(itemsKobo)),
        c.total(money(itemsKobo + fee)),
      ].join("\n"),
      buttons: {
        body: c.tapConfirmOrChange,
        buttons: [
          { id: "yes", title: c.confirmOrder },
          { id: "change address", title: c.changeAddress },
        ],
      },
    };
  }

  async function ownerCommand(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
    const text = (msg.text ?? "").trim().replace(/\s+/g, " ");
    if (/^(delivery|deliveries|riders help|livraison|livraisons)$/i.test(text)) return { text: t.ownerHelp(opts.orderPrefix, currencyName(opts.currency ?? "NGN", businessLang)) };
    if (/^riders$/i.test(text)) {
      const riders = await store.riders();
      return {
        text: riders.length
          ? [t.yourRiders, ...riders.map((r) => `• ${r.name} (+${r.waId})`)].join("\n")
          : t.noRiders,
      };
    }

    const add = text.match(/^add rider (.+?) (\+?[\d][\d -]{6,}\d)$/i);
    if (add) {
      const waId = nigerianWaId(add[2]!);
      if (!waId) return { text: t.notAPhone };
      const rider = await store.addRider(add[1]!.trim(), waId);
      return { text: t.added(rider.name, rider.waId) };
    }
    const remove = text.match(/^remove rider (.+)$/i);
    if (remove) {
      return {
        text: (await store.removeRider(remove[1]!.trim()))
          ? t.removed(remove[1]!.trim())
          : t.noSuchRider(remove[1]!.trim()),
      };
    }

    const fee = text.match(new RegExp(`^fee ${ORDER} (?:₦|n|ngn|f|cfa|fcfa)? ?(\\d[\\d,. ]*)$`, "i"));
    if (fee) return setFee(Number(fee[1]), Number(fee[2]!.replace(/[,. ]/g, "")));

    const rider = text.match(new RegExp(`^rider ${ORDER} (.+)$`, "i"));
    if (rider) return assign(Number(rider[1]), rider[2]!.trim(), ctx);

    const courier = text.match(new RegExp(`^courier ${ORDER}$`, "i"));
    if (courier) return courierCommand(Number(courier[1]));

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
    if (!order) return { text: t.cantFind(label) };
    if (order.status === "quoted" && !quotes) return { text: t.notConfirmed(label) };
    const d = await store.forOrder(order.id);
    if (!d) return { text: t.noDeliveryDetails(label) };
    return { order, d };
  }

  /** "courier KP-1001": the customer paid the owner directly, so the owner pays the courier fee by link. */
  async function courierCommand(orderNumber: number): Promise<Reply> {
    const found = await lookup(orderNumber);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (!d.courier || !opts.courier) return { text: t.noCourier(label) };
    if (d.courier.orderId || d.status !== "proposed") return { text: t.courierAlreadyBooked(label, d.courier.name) };
    if (!opts.courier.payLink) return { text: t.courierNoPayments };
    try {
      const url = await opts.courier.payLink(order, d.feeKobo ?? 0);
      return { text: t.courierPayLink(label, d.courier.name, money(d.feeKobo ?? 0), url) };
    } catch (err) {
      console.error(`Courier fee link for ${label} failed:`, err);
      return { text: t.courierNoPayments };
    }
  }

  async function setFee(orderNumber: number, whole: number): Promise<Reply> {
    const found = await lookup(orderNumber, true);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (order.status !== "quoted" || (d.status !== "needs_fee" && d.status !== "proposed")) {
      return { text: t.notWaitingForFee(label) };
    }
    // Whole naira or whole francs; stored in hundredths either way.
    const feeKobo = whole * 100;
    const itemsKobo = itemsAfterDiscount(order);
    if (!(await store.setQuoteTotal(order.id, itemsKobo + feeKobo))) {
      return { text: t.justConfirmed(label) };
    }
    const updated = await store.update(d.id, ["needs_fee", "proposed"], { status: "proposed", feeKobo });
    if (!updated) return { text: t.justChangedFee(label) };
    const offer = proposal(updated, itemsKobo);
    return {
      text: t.sentFee(updated.customerName ?? showWaId(updated.customerWaId), money(feeKobo), label, money(itemsKobo + feeKobo)),
      notify: [{ to: updated.customerWaId, text: offer.text, buttons: offer.buttons }],
    };
  }

  async function assign(orderNumber: number, who: string, ctx: ProductContext): Promise<Reply> {
    const found = await lookup(orderNumber);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (order.status === "cancelled" || d.status === "cancelled") return { text: t.wasCancelled(label) };
    if (d.status === "pickup") return { text: t.customerCollecting(label) };
    if (d.status === "picked_up") return { text: t.alreadyPicked(d.riderName ?? "", label) };
    if (d.status === "delivered") return { text: t.alreadyDelivered(label) };

    const riders = await store.riders();
    const waId = nigerianWaId(who);
    const rider = riders.find((r) => r.name.toLowerCase() === who.toLowerCase() || (waId !== null && r.waId === waId));
    if (!rider) {
      return { text: t.unknownRider(who, `${waId ? "Name" : who} ${waId ? who : "0803 123 4567"}`) };
    }

    const previous = d.status === "assigned" && d.riderWaId && d.riderWaId !== rider.waId ? d.riderWaId : null;
    const updated = await store.update(d.id, ["proposed", "assigned", "failed"], { status: "assigned", rider });
    if (!updated) return { text: t.justChangedRider(label, rider.name) };

    const job = jobText(updated, order);
    const notices: Notice[] = [
      {
        ...deliveryNotice(rider.waId, job, updated, opts.template),
        buttons: {
          body: t.tapWhen(label),
          buttons: [
            { id: `picked ${label}`, title: t.pickedUp },
            { id: `delivered ${label}`, title: t.delivered },
            { id: `failed ${label}`, title: t.couldntDeliver },
          ],
        },
      },
      deliveryNotice(
        updated.customerWaId,
        t.riderComing(rider.name, label, opts.businessName, opts.links.customer(updated)),
        updated,
        opts.template,
      ),
    ];
    if (previous) {
      notices.push(deliveryNotice(previous, t.goneElsewhere(label), updated, opts.template));
    }

    const lines = [t.sentTo(label, rider.name, updated.customerName ?? t.theCustomer)];
    if (!opts.template && !(await ctx.canMessageFreely(rider.waId))) {
      lines.push(
        "",
        t.riderSilent(rider.name, label),
        "",
        job,
      );
    }
    if (order.status !== "paid") {
      lines.push("", t.notPaidYet(label, rider.name));
    }
    return { text: lines.join("\n"), notify: notices };
  }

  function jobText(d: Delivery, order: OrderDetails): string {
    return t.job({
      ref: d.orderRef,
      business: opts.businessName,
      pickup: opts.pickup ?? opts.businessName,
      where: describe(d),
      map: mapLink(d),
      customer: `${d.customerName ? `${d.customerName}, ` : ""}+${d.customerWaId}`,
      payment: order.status === "paid" ? t.paid : t.unpaid(money(order.totalKobo), opts.businessName),
      link: opts.links.rider(d),
    });
  }

  async function cancelDelivery(orderNumber: number): Promise<Reply> {
    const found = await lookup(orderNumber, true);
    if (!("order" in found)) return found;
    const { order, d } = found;
    const label = ref(orderNumber);
    if (d.status === "delivered") return { text: t.alreadyDelivered(label) };
    const updated = await store.update(d.id, ["asking", "needs_fee", "proposed", "pickup", "assigned", "picked_up", "failed"], {
      status: "cancelled",
    });
    if (!updated) return { text: t.deliveryAlreadyCancelled(label) };
    if (order.status === "quoted") await store.setQuoteTotal(order.id, itemsAfterDiscount(order));

    const notices: Notice[] = [
      deliveryNotice(updated.customerWaId, t.deliveryCancelled(label, opts.businessName), updated, opts.template),
    ];
    if (updated.riderWaId && d.status !== "pickup") {
      const back = d.status === "picked_up" ? opts.businessName : null;
      notices.push(deliveryNotice(updated.riderWaId, t.dontDeliver(label, back), updated, opts.template));
    }
    const lines = [t.cancelledDelivery(label, updated.riderName && d.status !== "pickup" ? updated.riderName : null)];
    if (order.status === "paid") {
      lines.push("", t.refundNote(label, opts.payProvider ?? "Paystack"));
    }
    return { text: lines.join("\n"), notify: notices };
  }

  async function riderMessage(rider: Rider, msg: IncomingMessage): Promise<Reply | null> {
    const text = (msg.text ?? "").trim();
    const step = text.match(new RegExp(`^(picked(?: up)?|delivered|failed|couldn'?t deliver)(?: ${ORDER})?$`, "i"));
    if (step) {
      const d = step[2] ? await jobByNumber(Number(step[2]), rider) : await store.activeForRider(rider.waId);
      if (!d) return { text: step[2] ? t.notYours(ref(Number(step[2]))) : t.noJob };
      const word = step[1]!.toLowerCase();
      const to: RiderStep = word.startsWith("picked") ? "picked_up" : word === "delivered" ? "delivered" : "failed";
      const moved = await riderStep(store, d, to, { trackingLink: opts.links.customer(d), template: opts.template, lang: businessLang });
      if (!moved) return { text: t.alreadyMarked(d.orderRef, t.status[d.status] ?? d.status) };
      return { text: `${d.orderRef}: ${t.thanks[to]}`, notify: moved.notices };
    }

    if (msg.location || msg.type === "unsupported") {
      const d = await store.activeForRider(rider.waId);
      if (!d) return null;
      if (msg.location) {
        await store.setRiderPosition(d.id, msg.location.latitude, msg.location.longitude, new Date());
        return { text: t.gotLocation(d.orderRef, opts.links.rider(d)) };
      }
      return { text: t.noLiveLocation(opts.links.rider(d)) };
    }
    return null;
  }

  async function jobByNumber(orderNumber: number, rider: Rider): Promise<Delivery | null> {
    const order = await opts.orders.findOrder(orderNumber);
    const d = order ? await store.forOrder(order.id) : null;
    return d && d.riderWaId === rider.waId ? d : null;
  }
}
