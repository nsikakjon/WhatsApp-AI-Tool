import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BUSINESS_ID } from "../store.js";
import type { Zone } from "./zones.js";

// Delivery zones, riders and deliveries (migration 0030), one business at a time.

export type DeliveryStatus =
  | "asking"
  | "needs_fee"
  | "proposed"
  | "pickup"
  | "assigned"
  | "picked_up"
  | "delivered"
  | "failed"
  | "cancelled";

export interface Rider {
  id: string;
  name: string;
  waId: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  orderRef: string;
  businessName: string;
  fromNumberId: string | null;
  ownerWaId: string | null;
  customerWaId: string;
  customerName: string | null;
  status: DeliveryStatus;
  address: string | null;
  lat: number | null;
  lng: number | null;
  zoneName: string | null;
  feeKobo: number | null;
  riderId: string | null;
  riderName: string | null;
  riderWaId: string | null;
  riderLat: number | null;
  riderLng: number | null;
  riderSeenAt: Date | null;
  /** A Shipbubble courier offered or booked for it (migration 0053); null for the business's own riders. */
  courier: CourierInfo | null;
}

/** The courier side of a delivery: the price offered, and once paid for, the booking. */
export interface CourierInfo {
  name: string;
  courierId: string;
  serviceCode: string;
  requestToken: string;
  pickupEta: string | null;
  deliveryEta: string | null;
  /** Set once booked: Shipbubble's order id, the courier's tracking page and phone. */
  orderId?: string;
  trackingUrl?: string | null;
  phone?: string | null;
}

/** What is copied in when a delivery starts. */
export type NewDelivery = Pick<
  Delivery,
  "orderId" | "orderRef" | "businessName" | "fromNumberId" | "ownerWaId" | "customerWaId" | "customerName"
>;

export interface DeliveryChange {
  status?: DeliveryStatus;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  zoneName?: string | null;
  feeKobo?: number | null;
  rider?: Rider;
  courier?: CourierInfo | null;
}

export interface DeliveryStore {
  zones(): Promise<Zone[]>;
  riders(): Promise<Rider[]>;
  riderByWaId(waId: string): Promise<Rider | null>;
  /** Adds a rider, or renames and brings back one with the same number. */
  addRider(name: string, waId: string): Promise<Rider>;
  /** Stops offering a rider by name. False if there was no such rider. */
  removeRider(name: string): Promise<boolean>;
  forOrder(orderId: string): Promise<Delivery | null>;
  /** Any business's delivery, for the tracking pages. */
  get(id: string): Promise<Delivery | null>;
  /** The job a rider is on now (assigned or picked up), newest first. */
  activeForRider(waId: string): Promise<Delivery | null>;
  /** Starts the delivery for an order, or returns the one already started. */
  start(delivery: NewDelivery): Promise<Delivery>;
  /**
   * Changes a delivery only while its status is one of `from`. Returns the
   * changed delivery, or null if it had already moved on, so a repeated tap
   * or a retried webhook changes nothing.
   */
  update(id: string, from: DeliveryStatus[], change: DeliveryChange): Promise<Delivery | null>;
  /** Puts the delivery fee into a quote's total while it is still a quote. False if it isn't any more. */
  setQuoteTotal(orderId: string, totalKobo: number): Promise<boolean>;
  setRiderPosition(id: string, lat: number, lng: number, at: Date): Promise<void>;
  /** Any business's delivery booked with this Shipbubble order, for its webhook. */
  byCourierOrder?(orderId: string): Promise<Delivery | null>;
}

type DeliveryRow = {
  id: string;
  order_id: string;
  order_ref: string;
  business_name: string;
  from_number_id: string | null;
  owner_wa_id: string | null;
  customer_wa_id: string;
  customer_name: string | null;
  status: DeliveryStatus;
  address: string | null;
  lat: number | null;
  lng: number | null;
  zone_name: string | null;
  fee_kobo: number | string | null;
  rider_id: string | null;
  rider_name: string | null;
  rider_wa_id: string | null;
  rider_lat: number | null;
  rider_lng: number | null;
  rider_seen_at: string | null;
  // Until migration 0056 the column is 0030's text 'own_rider'.
  courier?: CourierInfo | string | null;
};

// Every column, so courier (migration 0053) is read once it exists and simply missing before.
const COLUMNS = "*";

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    orderId: row.order_id,
    orderRef: row.order_ref,
    businessName: row.business_name,
    fromNumberId: row.from_number_id,
    ownerWaId: row.owner_wa_id,
    customerWaId: row.customer_wa_id,
    customerName: row.customer_name,
    status: row.status,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    zoneName: row.zone_name,
    feeKobo: row.fee_kobo === null ? null : Number(row.fee_kobo),
    riderId: row.rider_id,
    riderName: row.rider_name,
    riderWaId: row.rider_wa_id,
    riderLat: row.rider_lat,
    riderLng: row.rider_lng,
    riderSeenAt: row.rider_seen_at ? new Date(row.rider_seen_at) : null,
    courier: typeof row.courier === "object" ? row.courier ?? null : null,
  };
}

const STAMPS: Partial<Record<DeliveryStatus, string>> = {
  assigned: "assigned_at",
  picked_up: "picked_up_at",
  delivered: "delivered_at",
};

export function createSupabaseDeliveryStore(db: SupabaseClient, businessId = DEFAULT_BUSINESS_ID): DeliveryStore {
  const one = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
    const { data, error } = await query;
    if (error) throw new Error(`${what} failed: ${error.message}`);
    return data ? toDelivery(data as DeliveryRow) : null;
  };

  return {
    async zones() {
      const { data, error } = await db
        .from("quote_delivery_zones")
        .select("id, name, areas, centre_lat, centre_lng, radius_m, fee_kobo")
        .eq("business_id", businessId)
        .eq("active", true);
      if (error) throw new Error(`delivery zones failed: ${error.message}`);
      return (data ?? []).map((z) => ({
        id: z.id as string,
        name: z.name as string,
        areas: (z.areas as string[]) ?? [],
        circle:
          z.centre_lat !== null && z.centre_lng !== null && z.radius_m !== null
            ? { lat: z.centre_lat as number, lng: z.centre_lng as number, radiusM: z.radius_m as number }
            : null,
        feeKobo: Number(z.fee_kobo),
      }));
    },

    async riders() {
      const { data, error } = await db
        .from("quote_riders")
        .select("id, name, wa_id")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("name");
      if (error) throw new Error(`riders failed: ${error.message}`);
      return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, waId: r.wa_id as string }));
    },

    async riderByWaId(waId) {
      const { data, error } = await db
        .from("quote_riders")
        .select("id, name, wa_id")
        .eq("business_id", businessId)
        .eq("wa_id", waId)
        .eq("active", true)
        .maybeSingle();
      if (error) throw new Error(`rider lookup failed: ${error.message}`);
      return data ? { id: data.id as string, name: data.name as string, waId: data.wa_id as string } : null;
    },

    async addRider(name, waId) {
      const { data, error } = await db
        .from("quote_riders")
        .upsert({ business_id: businessId, name, wa_id: waId, active: true }, { onConflict: "business_id,wa_id" })
        .select("id, name, wa_id")
        .single();
      if (error) throw new Error(`addRider failed: ${error.message}`);
      return { id: data.id as string, name: data.name as string, waId: data.wa_id as string };
    },

    async removeRider(name) {
      const { data, error } = await db
        .from("quote_riders")
        .update({ active: false })
        .eq("business_id", businessId)
        .eq("active", true)
        .ilike("name", name)
        .select("id");
      if (error) throw new Error(`removeRider failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    forOrder: (orderId) =>
      one(db.from("quote_deliveries").select(COLUMNS).eq("business_id", businessId).eq("order_id", orderId).maybeSingle(), "delivery lookup"),

    get: (id) => one(db.from("quote_deliveries").select(COLUMNS).eq("id", id).maybeSingle(), "delivery lookup"),

    activeForRider: (waId) =>
      one(
        db
          .from("quote_deliveries")
          .select(COLUMNS)
          .eq("business_id", businessId)
          .eq("rider_wa_id", waId)
          .in("status", ["assigned", "picked_up"])
          .order("assigned_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "rider's delivery lookup",
      ),

    async start(d) {
      const { error } = await db.from("quote_deliveries").upsert(
        {
          order_id: d.orderId,
          business_id: businessId,
          order_ref: d.orderRef,
          business_name: d.businessName,
          from_number_id: d.fromNumberId,
          owner_wa_id: d.ownerWaId,
          customer_wa_id: d.customerWaId,
          customer_name: d.customerName,
        },
        { onConflict: "order_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`start delivery failed: ${error.message}`);
      const saved = await this.forOrder(d.orderId);
      if (!saved) throw new Error(`start delivery failed: no delivery for order ${d.orderRef}`);
      return saved;
    },

    async update(id, from, change) {
      const now = new Date().toISOString();
      const row: Record<string, unknown> = { updated_at: now };
      if (change.status) {
        row.status = change.status;
        const stamp = STAMPS[change.status];
        if (stamp) row[stamp] = now;
      }
      if (change.address !== undefined) row.address = change.address;
      if (change.lat !== undefined) row.lat = change.lat;
      if (change.lng !== undefined) row.lng = change.lng;
      if (change.zoneName !== undefined) row.zone_name = change.zoneName;
      if (change.feeKobo !== undefined) row.fee_kobo = change.feeKobo;
      if (change.courier !== undefined) {
        row.courier = change.courier;
        row.courier_order_id = change.courier?.orderId ?? null;
      }
      if (change.rider) {
        row.rider_id = change.rider.id;
        row.rider_name = change.rider.name;
        row.rider_wa_id = change.rider.waId;
        row.rider_lat = null;
        row.rider_lng = null;
        row.rider_seen_at = null;
      }
      return one(
        db.from("quote_deliveries").update(row).eq("id", id).in("status", from).select(COLUMNS).maybeSingle(),
        "update delivery",
      );
    },

    async setQuoteTotal(orderId, totalKobo) {
      const { data, error } = await db
        .from("quote_orders")
        .update({ total_kobo: totalKobo, updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("business_id", businessId)
        .eq("status", "quoted")
        .select("id");
      if (error) throw new Error(`setQuoteTotal failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    byCourierOrder: (orderId) => one(db.from("quote_deliveries").select(COLUMNS).eq("courier_order_id", orderId).maybeSingle(), "courier delivery lookup"),

    async setRiderPosition(id, lat, lng, at) {
      const { error } = await db
        .from("quote_deliveries")
        .update({ rider_lat: lat, rider_lng: lng, rider_seen_at: at.toISOString() })
        .eq("id", id)
        .in("status", ["assigned", "picked_up"]);
      if (error) throw new Error(`setRiderPosition failed: ${error.message}`);
    },
  };
}
