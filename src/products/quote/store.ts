import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteLine, Variant } from "./pricing.js";

// Reading the price list and saving quotes/orders. Kept behind interfaces so
// tests can use in-memory versions instead of a real database.

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
const LOGO_PATH = "logo";

export function createSupabaseBranding(db: SupabaseClient): BrandingStore {
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

export function createSupabaseCatalog(db: SupabaseClient): CatalogStore {
  return {
    async activeVariants() {
      const { data, error } = await db
        .from("quote_variants")
        .select(
          "id, name, min_quantity, quote_products!inner(name, active), quote_price_tiers(min_quantity, unit_price_kobo)",
        )
        .eq("active", true)
        .eq("quote_products.active", true);
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

export function createSupabaseOrders(db: SupabaseClient): OrderStore {
  return {
    async createQuote(contactId, lines, totalKobo) {
      const { data: order, error } = await db
        .from("quote_orders")
        .insert({ contact_id: contactId, total_kobo: totalKobo })
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
      const { data, error } = await db
        .from("quote_orders")
        .select("id, order_number, total_kobo, quote_order_items(variant_id, name, quantity, unit_price_kobo, total_kobo)")
        .eq("contact_id", contactId)
        .eq("status", "quoted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`latestOpenQuote failed: ${error.message}`);
      return data ? toSavedOrder(data as unknown as OrderRow) : null;
    },

    async findOrder(orderNumber) {
      const { data, error } = await db
        .from("quote_orders")
        .select(
          "id, order_number, total_kobo, status, created_at, paid_at, contacts(wa_id, name), quote_order_items(variant_id, name, quantity, unit_price_kobo, total_kobo)",
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
      const { data, error } = await db
        .from("quote_orders")
        .update({ status: "paid", paid_at: now, updated_at: now })
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
      const { data, error } = await db
        .from("quote_orders")
        .update(update)
        .eq("id", orderId)
        .eq("status", "quoted")
        .select("id");
      if (error) throw new Error(`setStatus failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
