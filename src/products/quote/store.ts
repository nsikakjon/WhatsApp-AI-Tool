import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteLine, Variant } from "./pricing.js";

// Reading the price list and saving quotes/orders. Kept behind interfaces so
// tests can use in-memory versions instead of a real database.
//
// Several businesses can share the bot (migration 0020): each has its own
// price list and orders. The Supabase stores below take the business id to
// work for. Leaving it out reads and writes without looking at businesses at
// all, exactly as before 0020, which is how business #1 runs while
// QUOTE_MULTI_BUSINESS is off.

/** Business #1, the one on the main WhatsApp number (fixed id set in migration 0020). */
export const DEFAULT_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

/** One business the quote bot answers for. */
export interface QuoteBusiness {
  id: string;
  name: string;
  /** What the business does, e.g. "a print shop". Helps the AI understand customers. */
  description: string | null;
  /** Order numbers look like KP-1001; this is the "KP". */
  orderPrefix: string;
  /** The WhatsApp "Phone number ID" its customers message. Null for business #1 (main number). */
  phoneNumberId: string | null;
  /** WhatsApp number (digits only) that gets new-order alerts. */
  ownerWaId: string | null;
  businessDetails: string | null;
  paymentDetails: string | null;
  active: boolean;
  updatedAt: Date;
}

export interface BusinessStore {
  /** The business whose customers message this WhatsApp number, if any. */
  findByPhoneNumberId(phoneNumberId: string): Promise<QuoteBusiness | null>;
  get(id: string): Promise<QuoteBusiness | null>;
  /** Every business, oldest first. */
  list(): Promise<QuoteBusiness[]>;
}

export interface CatalogStore {
  /** Every active variant with its price tiers. Names read "Product: variant". */
  activeVariants(): Promise<Variant[]>;
}

export interface SavedOrder {
  id: string;
  orderNumber: number;
  totalKobo: number;
  lines: QuoteLine[];
}

export interface OrderStore {
  /** Saves a new quote (status 'quoted') and returns it with its order number. */
  createQuote(contactId: string, lines: QuoteLine[], totalKobo: number): Promise<SavedOrder>;
  /** The customer's most recent quote that is still waiting for a yes or no. */
  latestOpenQuote(contactId: string): Promise<SavedOrder | null>;
  /**
   * Moves a quote to 'confirmed' or 'cancelled'. Returns false if it was no
   * longer 'quoted' (e.g. already confirmed), so a repeated YES does nothing.
   */
  setStatus(orderId: string, status: "confirmed" | "cancelled"): Promise<boolean>;
  /** Looks an order up by its number (1042 in KP-1042), with who it's for. */
  findOrder(orderNumber: number): Promise<OrderDetails | null>;
  /**
   * Marks a quoted or confirmed order as paid. Returns false if it wasn't one
   * of those (already paid, or cancelled), so a repeated "paid" does nothing.
   */
  markPaid(orderId: string): Promise<boolean>;
}

export type OrderStatus = "quoted" | "confirmed" | "paid" | "cancelled";

export interface OrderDetails extends SavedOrder {
  status: OrderStatus;
  customerWaId: string;
  customerName: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

/** The business logo printed on invoices and receipts. */
export interface BrandingStore {
  logo(): Promise<Uint8Array | null>;
  saveLogo(data: Uint8Array, mimeType: string): Promise<void>;
}

const FILES_BUCKET = "quote-files";

/** Business #1 keeps the logo it has always had; other businesses get their own file. */
function logoPath(businessId?: string): string {
  return !businessId || businessId === DEFAULT_BUSINESS_ID ? "logo" : `businesses/${businessId}/logo`;
}

type BusinessRow = {
  id: string;
  name: string;
  description: string | null;
  order_prefix: string;
  phone_number_id: string | null;
  owner_wa_id: string | null;
  business_details: string | null;
  payment_details: string | null;
  active: boolean;
  updated_at: string;
};

const BUSINESS_COLUMNS =
  "id, name, description, order_prefix, phone_number_id, owner_wa_id, business_details, payment_details, active, updated_at";

function toBusiness(row: BusinessRow): QuoteBusiness {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    orderPrefix: row.order_prefix,
    phoneNumberId: row.phone_number_id,
    ownerWaId: row.owner_wa_id,
    businessDetails: row.business_details,
    paymentDetails: row.payment_details,
    active: row.active,
    updatedAt: new Date(row.updated_at),
  };
}

export function createSupabaseBusinesses(db: SupabaseClient): BusinessStore {
  const one = async (column: "id" | "phone_number_id", value: string) => {
    const { data, error } = await db.from("quote_businesses").select(BUSINESS_COLUMNS).eq(column, value).maybeSingle();
    if (error) throw new Error(`quote business lookup failed: ${error.message}`);
    return data ? toBusiness(data as BusinessRow) : null;
  };
  return {
    findByPhoneNumberId: (phoneNumberId) => one("phone_number_id", phoneNumberId),
    get: (id) => one("id", id),
    async list() {
      const { data, error } = await db.from("quote_businesses").select(BUSINESS_COLUMNS).order("created_at");
      if (error) throw new Error(`list quote businesses failed: ${error.message}`);
      return (data ?? []).map((row) => toBusiness(row as BusinessRow));
    },
  };
}

export function createSupabaseBranding(db: SupabaseClient, businessId?: string): BrandingStore {
  const LOGO_PATH = logoPath(businessId);
  return {
    async logo() {
      const { data, error } = await db.storage.from(FILES_BUCKET).download(LOGO_PATH);
      // No logo uploaded yet is normal: documents are drawn without one.
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async saveLogo(data, mimeType) {
      const { error } = await db.storage.from(FILES_BUCKET).upload(LOGO_PATH, data, { contentType: mimeType, upsert: true });
      if (error) throw new Error(`saveLogo failed: ${error.message}`);
    },
  };
}

export function createSupabaseCatalog(db: SupabaseClient, businessId?: string): CatalogStore {
  return {
    async activeVariants() {
      let query = db
        .from("quote_variants")
        .select(
          "id, name, min_quantity, quote_products!inner(name, active), quote_price_tiers(min_quantity, unit_price_kobo)",
        )
        .eq("active", true)
        .eq("quote_products.active", true);
      if (businessId) query = query.eq("quote_products.business_id", businessId);
      const { data, error } = await query;
      if (error) throw new Error(`activeVariants failed: ${error.message}`);

      return (data ?? []).map((row) => {
        const product = row.quote_products as unknown as { name: string };
        const tiers = (row.quote_price_tiers ?? []) as Array<{ min_quantity: number; unit_price_kobo: number | string }>;
        return {
          id: row.id as string,
          name: `${product.name}: ${row.name as string}`,
          minQuantity: row.min_quantity as number,
          tiers: tiers.map((t) => ({ minQuantity: t.min_quantity, unitPriceKobo: Number(t.unit_price_kobo) })),
        };
      });
    },
  };
}

type OrderRow = {
  id: string;
  order_number: number | string;
  total_kobo: number | string;
  quote_order_items: Array<{
    variant_id: string;
    name: string;
    quantity: number;
    unit_price_kobo: number | string;
    total_kobo: number | string;
  }>;
};

function toSavedOrder(row: OrderRow): SavedOrder {
  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    totalKobo: Number(row.total_kobo),
    lines: row.quote_order_items.map((i) => ({
      variantId: i.variant_id,
      name: i.name,
      quantity: i.quantity,
      unitPriceKobo: Number(i.unit_price_kobo),
      totalKobo: Number(i.total_kobo),
    })),
  };
}

export function createSupabaseOrders(db: SupabaseClient, businessId?: string): OrderStore {
  // Every order lookup and change stays inside this business's orders.
  // (The cast keeps TypeScript from expanding Supabase's deep query types.)
  const mine = <Q,>(query: Q): Q =>
    businessId ? (query as unknown as { eq(c: string, v: string): Q }).eq("business_id", businessId) : query;

  return {
    async createQuote(contactId, lines, totalKobo) {
      const { data: order, error } = await db
        .from("quote_orders")
        .insert({ contact_id: contactId, total_kobo: totalKobo, ...(businessId ? { business_id: businessId } : {}) })
        .select("id, order_number")
        .single();
      if (error) throw new Error(`createQuote failed: ${error.message}`);

      const { error: itemsError } = await db.from("quote_order_items").insert(
        lines.map((l) => ({
          order_id: order.id,
          variant_id: l.variantId,
          name: l.name,
          quantity: l.quantity,
          unit_price_kobo: l.unitPriceKobo,
          total_kobo: l.totalKobo,
        })),
      );
      if (itemsError) {
        // Don't leave a quote with no lines behind.
        await db.from("quote_orders").delete().eq("id", order.id);
        throw new Error(`createQuote items failed: ${itemsError.message}`);
      }
      return { id: order.id as string, orderNumber: Number(order.order_number), totalKobo, lines };
    },

    async latestOpenQuote(contactId) {
      const { data, error } = await mine(
        db
          .from("quote_orders")
          .select("id, order_number, total_kobo, quote_order_items(variant_id, name, quantity, unit_price_kobo, total_kobo)"),
      )
        .eq("contact_id", contactId)
        .eq("status", "quoted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`latestOpenQuote failed: ${error.message}`);
      return data ? toSavedOrder(data as unknown as OrderRow) : null;
    },

    async findOrder(orderNumber) {
      const { data, error } = await mine(
        db
          .from("quote_orders")
          .select(
            "id, order_number, total_kobo, status, created_at, paid_at, contacts(wa_id, name), quote_order_items(variant_id, name, quantity, unit_price_kobo, total_kobo)",
          ),
      )
        .eq("order_number", orderNumber)
        .maybeSingle();
      if (error) throw new Error(`findOrder failed: ${error.message}`);
      if (!data) return null;
      const row = data as unknown as OrderRow & {
        status: OrderStatus;
        created_at: string;
        paid_at: string | null;
        contacts: { wa_id: string; name: string | null };
      };
      return {
        ...toSavedOrder(row),
        status: row.status,
        customerWaId: row.contacts.wa_id,
        customerName: row.contacts.name,
        createdAt: new Date(row.created_at),
        paidAt: row.paid_at ? new Date(row.paid_at) : null,
      };
    },

    async markPaid(orderId) {
      const now = new Date().toISOString();
      const { data, error } = await mine(
        db.from("quote_orders").update({ status: "paid", paid_at: now, updated_at: now }),
      )
        .eq("id", orderId)
        .in("status", ["quoted", "confirmed"])
        .select("id");
      if (error) throw new Error(`markPaid failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async setStatus(orderId, status) {
      const now = new Date().toISOString();
      const update: Record<string, unknown> = { status, updated_at: now };
      if (status === "confirmed") update.confirmed_at = now;
      const { data, error } = await mine(db.from("quote_orders").update(update))
        .eq("id", orderId)
        .eq("status", "quoted")
        .select("id");
      if (error) throw new Error(`setStatus failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
