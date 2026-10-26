import { createHmac, timingSafeEqual } from "node:crypto";

// Shipbubble: one connection to many Nigerian couriers (Kwik, Gokada, GIG,
// DHL and others). yarnOga keeps one Shipbubble account with a naira wallet.
//
// 1. When a customer's address isn't in any of the business's own delivery
//    zones, we ask Shipbubble for courier prices and offer the cheapest
//    courier that collects from the shop. The price is Shipbubble's, never
//    the AI's.
// 2. Once the courier fee has been paid to yarnOga (split off a pay link, or
//    paid by the owner through a link), we book the courier, which takes the
//    fee from the wallet. The wallet only ever spends money already collected.
// 3. Shipbubble tells us about pickup and delivery by a signed webhook.
//
// Shipbubble works in naira (amounts like 3063 or 12451.04); we keep kobo.

export interface ShipbubbleConfig {
  /** sb_sandbox_... for testing, sb_prod_... when live. */
  apiKey: string;
  /** Shipbubble needs an email for sender and receiver; WhatsApp gives none, so this one is used. */
  contactEmail: string;
  /** Package category id (GET /shipping/labels/categories); the first category when unset. */
  categoryId?: number;
  /** Weight of one item, in kg, when the price list doesn't say. */
  itemKg: number;
  apiUrl?: string;
}

export interface CourierParty {
  name: string;
  /** International digits, e.g. 2348012345678. */
  phone: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
}

export interface CourierItem {
  name: string;
  quantity: number;
  /** Price of one, in kobo. */
  unitKobo: number;
}

/** A courier price we can offer, and what's needed to book it. */
export interface CourierQuote {
  feeKobo: number;
  courierName: string;
  courierId: string;
  serviceCode: string;
  requestToken: string;
  /** e.g. "Within 3 hours" and "Within 1 - 2 working days". */
  pickupEta: string | null;
  deliveryEta: string | null;
}

export interface CourierBooking {
  orderId: string;
  trackingUrl: string | null;
  courierName: string;
  courierPhone: string | null;
}

export interface CourierService {
  /** The cheapest courier that collects from the shop, or null when none can. */
  quote(from: CourierParty, to: CourierParty, items: CourierItem[]): Promise<CourierQuote | null>;
  book(quote: Pick<CourierQuote, "requestToken" | "courierId" | "serviceCode">): Promise<CourierBooking>;
}

/** Shipbubble signs each webhook: HMAC-SHA512 of the raw body, keyed with our API key, in x-ship-signature. */
export function isValidShipbubbleSignature(rawBody: string, header: string | undefined, apiKey: string): boolean {
  if (!header || !/^[0-9a-f]+$/i.test(header)) return false;
  const received = Buffer.from(header, "hex");
  const expected = createHmac("sha512", apiKey).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Shipbubble's shipment status as one of our delivery steps; null for ones we don't act on (pending, confirmed). */
export function courierStep(status: string): "picked_up" | "delivered" | "failed" | null {
  const s = status.toLowerCase();
  if (s === "picked_up" || s === "in_transit") return "picked_up";
  if (s === "completed" || s === "delivered") return "delivered";
  if (s === "cancelled" || s === "failed") return "failed";
  return null;
}

/** Naira as Shipbubble sends it (3063 or 12451.04) to whole kobo. */
export function nairaToKoboAmount(naira: unknown): number | null {
  const n = Number(naira);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** The day to ask for: today, or tomorrow from 6pm Lagos time, when Shipbubble moves requests to the next day anyway. */
export function pickupDate(now: Date): string {
  const lagos = new Date(now.getTime() + 60 * 60_000);
  if (lagos.getUTCHours() >= 18) lagos.setUTCDate(lagos.getUTCDate() + 1);
  return lagos.toISOString().slice(0, 10);
}

export function createShipbubble(config: ShipbubbleConfig, opts: { fetch?: typeof fetch; now?: () => Date } = {}): CourierService {
  const doFetch = opts.fetch ?? fetch;
  const base = (config.apiUrl ?? "https://api.shipbubble.com/v1").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
  const addressCodes = new Map<string, number>();
  let categoryId = config.categoryId;

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; errors?: string[]; data?: unknown };
    if (!res.ok || body.status !== "success") {
      const why = [body.message, ...(body.errors ?? [])].filter(Boolean).join("; ");
      throw new Error(`Shipbubble ${path} failed (${res.status}): ${why || "no message"}`);
    }
    return body.data;
  }

  /** Shipbubble's code for an address, worked out once and remembered. */
  async function addressCode(p: CourierParty): Promise<number> {
    const key = `${p.phone}|${p.address}|${p.lat ?? ""}|${p.lng ?? ""}`;
    const known = addressCodes.get(key);
    if (known) return known;
    const data = (await call("/shipping/address/validate", {
      method: "POST",
      body: JSON.stringify({
        name: p.name,
        email: config.contactEmail,
        phone: `+${p.phone}`,
        address: p.address,
        ...(p.lat != null && p.lng != null ? { latitude: p.lat, longitude: p.lng } : {}),
      }),
    })) as { address_code?: number };
    if (!data?.address_code) throw new Error("Shipbubble couldn't find that address");
    addressCodes.set(key, data.address_code);
    return data.address_code;
  }

  async function category(): Promise<number> {
    if (categoryId) return categoryId;
    const list = (await call("/shipping/labels/categories")) as Array<{ category_id: number }>;
    if (!list?.[0]) throw new Error("Shipbubble has no package categories");
    categoryId = list[0].category_id;
    return categoryId;
  }

  return {
    async quote(from, to, items) {
      const [sender, receiver, cat] = await Promise.all([addressCode(from), addressCode(to), category()]);
      const data = (await call("/shipping/fetch_rates", {
        method: "POST",
        body: JSON.stringify({
          sender_address_code: sender,
          reciever_address_code: receiver,
          pickup_date: pickupDate(opts.now ? opts.now() : new Date()),
          category_id: cat,
          // The courier collects from the shop; a drop-off courier would send the owner to a station.
          service_type: "pickup",
          package_items: items.map((i) => ({
            name: i.name.slice(0, 100),
            description: i.name.slice(0, 100),
            unit_weight: String(config.itemKg),
            unit_amount: String(Math.round(i.unitKobo / 100)),
            quantity: String(i.quantity),
          })),
          package_dimension: { length: 30, width: 25, height: 15 },
        }),
      })) as { request_token?: string; couriers?: Array<Record<string, unknown>> };
      const token = data?.request_token;
      const offers = (data?.couriers ?? [])
        .filter((c) => c.service_type === "pickup")
        .map((c) => ({ c, fee: nairaToKoboAmount(c.rate_card_amount ?? c.total) }))
        .filter((x): x is { c: Record<string, unknown>; fee: number } => x.fee !== null)
        .sort((a, b) => a.fee - b.fee);
      const best = offers[0];
      if (!token || !best) return null;
      return {
        feeKobo: best.fee,
        courierName: String(best.c.courier_name ?? "Courier"),
        courierId: String(best.c.courier_id),
        serviceCode: String(best.c.service_code),
        requestToken: token,
        pickupEta: typeof best.c.pickup_eta === "string" ? best.c.pickup_eta : null,
        deliveryEta: typeof best.c.delivery_eta === "string" ? best.c.delivery_eta : null,
      };
    },

    async book(q) {
      const data = (await call("/shipping/labels", {
        method: "POST",
        body: JSON.stringify({ request_token: q.requestToken, courier_id: q.courierId, service_code: q.serviceCode }),
      })) as { order_id?: string; tracking_url?: string; courier?: { name?: string; phone?: string } };
      if (!data?.order_id) throw new Error("Shipbubble didn't return an order id");
      return {
        orderId: data.order_id,
        trackingUrl: data.tracking_url ?? null,
        courierName: data.courier?.name ?? "Courier",
        courierPhone: data.courier?.phone ?? null,
      };
    },
  };
}
