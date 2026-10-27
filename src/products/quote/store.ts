import { isLang, type Lang } from "../../core/i18n.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertKobo, isCurrency, type Currency } from "../../core/money.js";
import { productSlug, type PriceListItem } from "./pricelist.js";
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
  /** The main business this one is a branch of (migration 0038), or null. A branch follows its main business's plan. */
  branchOf?: string | null;
  /** Where pay links on its invoices pay out (migration 0045): a Paystack subaccount code, ACCT_... */
  paystackSubaccount?: string | null;
  /** Where CFA franc pay links pay out (migration 0052): a Flutterwave subaccount ID, RS_... */
  flutterwaveSubaccount?: string | null;
  /** The language its owner messages and invoices use, and customers get when theirs isn't clear (migration 0051). */
  language?: Lang;
  /** The currency its prices are in (migration 0051). */
  currency?: Currency;
  /** Answer a customer's voice note with a voice note (migration 0051). */
  voiceReplies?: boolean;
  /** Offer Shipbubble couriers for addresses outside its zones (migration 0053). */
  courierDelivery?: boolean;
  /** Remind customers who confirmed but haven't paid (migration 0054; on unless switched off). */
  payRemindersOn?: boolean;
  /** Send the owner a morning summary (migration 0054; on unless switched off). */
  dailySummaryOn?: boolean;
  /** Ask customers to rate finished orders (migration 0054; on unless switched off). */
  ratingsOn?: boolean;
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
  /** The customer's most recent confirmed or paid order, for "order again". */
  lastOrder?(contactId: string): Promise<SavedOrder | null>;
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
  branch_of?: string | null;
  paystack_subaccount?: string | null;
  flutterwave_subaccount?: string | null;
  language?: string | null;
  currency?: string | null;
  voice_replies?: boolean | null;
  courier_delivery?: boolean | null;
  pay_reminders_on?: boolean | null;
  daily_summary_on?: boolean | null;
  ratings_on?: boolean | null;
  updated_at: string;
};

// Every column, so branch_of is read once migration 0038 is run and simply
// missing before then.
const BUSINESS_COLUMNS = "*";

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
    branchOf: row.branch_of ?? null,
    paystackSubaccount: row.paystack_subaccount ?? null,
    flutterwaveSubaccount: row.flutterwave_subaccount ?? null,
    language: isLang(row.language) ? row.language : "en",
    currency: isCurrency(row.currency) ? row.currency : "NGN",
    voiceReplies: row.voice_replies === true,
    courierDelivery: row.courier_delivery === true,
    payRemindersOn: row.pay_reminders_on !== false,
    dailySummaryOn: row.daily_summary_on !== false,
    ratingsOn: row.ratings_on !== false,
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

    async lastOrder(contactId) {
      const { data, error } = await mine(
        db
          .from("quote_orders")
          .select("id, order_number, total_kobo, quote_order_items(variant_id, name, quantity, unit_price_kobo, total_kobo)"),
      )
        .eq("contact_id", contactId)
        .in("status", ["confirmed", "paid"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`lastOrder failed: ${error.message}`);
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

/** The settings an owner fills in on the setup screen. */
export type BusinessSettings = Omit<QuoteBusiness, "id" | "updatedAt">;

/** What the owner setup screen changes: business settings and whole price lists. */
export interface SetupStore {
  createBusiness(settings: BusinessSettings): Promise<QuoteBusiness>;
  updateBusiness(id: string, settings: BusinessSettings): Promise<QuoteBusiness>;
  /** The business's price list as it is now (switched-off items left out). */
  priceList(businessId: string): Promise<PriceListItem[]>;
  /** Swaps in a whole new price list at once (migration 0023): all of it saves, or none of it. */
  replacePriceList(businessId: string, items: PriceListItem[]): Promise<void>;
}

/** Thrown when another business already uses that WhatsApp number. */
export class NumberTakenError extends Error {}

export function createSupabaseSetup(db: SupabaseClient): SetupStore {
  const row = (s: BusinessSettings) => ({
    name: s.name,
    description: s.description,
    order_prefix: s.orderPrefix,
    phone_number_id: s.phoneNumberId,
    owner_wa_id: s.ownerWaId,
    business_details: s.businessDetails,
    payment_details: s.paymentDetails,
    active: s.active,
    // Only written when the branches setting is on (the column needs migration 0038).
    ...(s.branchOf !== undefined ? { branch_of: s.branchOf } : {}),
    // Only written when pay links are on (migration 0045).
    ...(s.paystackSubaccount !== undefined ? { paystack_subaccount: s.paystackSubaccount } : {}),
  });
  const failed = (what: string, error: { code?: string; message: string }) =>
    error.code === "23505" ? new NumberTakenError("number taken") : new Error(`${what} failed: ${error.message}`);

  return {
    async createBusiness(settings) {
      const { data, error } = await db.from("quote_businesses").insert(row(settings)).select(BUSINESS_COLUMNS).single();
      if (error) throw failed("createBusiness", error);
      return toBusiness(data as BusinessRow);
    },
    async updateBusiness(id, settings) {
      const { data, error } = await db
        .from("quote_businesses")
        .update({ ...row(settings), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(BUSINESS_COLUMNS)
        .single();
      if (error) throw failed("updateBusiness", error);
      return toBusiness(data as BusinessRow);
    },
    async priceList(businessId) {
      const { data, error } = await db
        .from("quote_products")
        .select("name, created_at, quote_variants(name, min_quantity, active, created_at, quote_price_tiers(min_quantity, unit_price_kobo))")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("created_at");
      if (error) throw new Error(`priceList failed: ${error.message}`);
      type Row = {
        name: string;
        quote_variants: Array<{
          name: string;
          min_quantity: number;
          active: boolean;
          created_at: string;
          quote_price_tiers: Array<{ min_quantity: number; unit_price_kobo: number | string }>;
        }>;
      };
      return ((data ?? []) as unknown as Row[]).flatMap((p) =>
        p.quote_variants
          .filter((v) => v.active)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((v) => ({
            product: p.name,
            option: v.name,
            minQuantity: v.min_quantity,
            tiers: v.quote_price_tiers
              .map((t) => ({ minQuantity: t.min_quantity, unitPriceKobo: Number(t.unit_price_kobo) }))
              .sort((a, b) => a.minQuantity - b.minQuantity),
          })),
      );
    },
    async replacePriceList(businessId, items) {
      if (!items.length) throw new Error("replacePriceList: the new price list is empty");
      const { error } = await db.rpc("quote_replace_price_list", {
        p_business_id: businessId,
        p_items: items.map((i) => ({
          slug: productSlug(i.product),
          product: i.product,
          option: i.option,
          minQuantity: i.minQuantity,
          tiers: i.tiers.map((t) => ({ minQuantity: t.minQuantity, unitPriceKobo: assertKobo(t.unitPriceKobo, "price") })),
        })),
      });
      if (error) throw new Error(`replacePriceList failed: ${error.message}`);
    },
  };
}
