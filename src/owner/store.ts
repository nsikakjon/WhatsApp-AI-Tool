import { createSupabaseAbout, type BusinessAbout, type OpeningHours } from "../products/quote/about.js";
import type { Lang } from "../core/i18n.js";
import type { Currency } from "../core/money.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertKobo } from "../core/money.js";
import { productSlug } from "../products/quote/pricelist.js";
import type { PriceTier } from "../products/quote/pricing.js";

// What the owner app reads and writes (migration 0049, plus the quote bot's
// own tables). Kept behind interfaces so tests use in-memory versions.

export type Role = "owner" | "staff";

export interface AppUser {
  id: string;
  businessId: string;
  waId: string;
  name: string | null;
  role: Role;
  passwordHash: string | null;
  sessionEpoch: number;
  active: boolean;
  lastLoginAt: Date | null;
}

export interface UserStore {
  get(id: string): Promise<AppUser | null>;
  /** Every active row for this WhatsApp number (one per business they work for). */
  byWaId(waId: string): Promise<AppUser[]>;
  /** The owner's row, made the first time (or switched back on, as owner). */
  ensureOwner(businessId: string, waId: string): Promise<AppUser>;
  team(businessId: string): Promise<AppUser[]>;
  addStaff(businessId: string, waId: string, name: string): Promise<AppUser>;
  /** Switches a staff member off; their logins stop working at once. */
  removeStaff(businessId: string, userId: string): Promise<void>;
  /** Sets the password on every row for this number and logs out their other logins. */
  setPassword(waId: string, hash: string): Promise<void>;
  /** "Log out everywhere": logins made before now stop working. */
  bumpEpoch(waId: string): Promise<void>;
  touchLogin(userId: string): Promise<void>;
  saveToken(userId: string, hash: string, expires: Date): Promise<void>;
  /** Uses up a login link: the user's id, or null when it's wrong, used or expired. Works once. */
  useToken(hash: string, now: Date): Promise<string | null>;
}

export interface ProductOption {
  id?: string;
  /** e.g. "A5, both sides". */
  name: string;
  minQuantity: number;
  /** Null when stock isn't counted (made to order). */
  stock: number | null;
  /** Price per piece from each quantity up. Empty: priced by the team. */
  tiers: PriceTier[];
}

export interface ProductInput {
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  leadTimeDays: number | null;
  active: boolean;
  options: ProductOption[];
}

export interface ProductRecord extends ProductInput {
  id: string;
  photoPath: string | null;
}

/** Thrown when another product already has that name. */
export class DuplicateProductError extends Error {}

export interface PriceStore {
  products(): Promise<ProductRecord[]>;
  product(id: string): Promise<ProductRecord | null>;
  /** Saves a product and its options; returns its id. Options left out are switched off (old orders keep them). */
  save(id: string | null, input: ProductInput): Promise<string>;
  /** Takes a product off the price list (switched off, so old orders still show it). */
  remove(id: string): Promise<void>;
}

export interface ZoneRecord {
  id: string;
  name: string;
  areas: string[];
  feeKobo: number;
}

export interface RiderRecord {
  id: string;
  name: string;
  waId: string;
}

/** A delivery with a rider on it right now, and where the rider last was. */
export interface LiveDelivery {
  id: string;
  orderRef: string;
  status: "assigned" | "picked_up";
  riderName: string | null;
  riderWaId: string | null;
  customerName: string | null;
  customerWaId: string;
  address: string | null;
  /** The drop-off pin, when the customer shared one. */
  drop: { lat: number; lng: number } | null;
  /** Where the rider's page last reported them; null until they start sharing. */
  rider: { lat: number; lng: number; seenAt: Date } | null;
  assignedAt: Date | null;
  /** The customer's tracking page, so the owner sees what the customer sees. */
  trackLink?: string;
}

export interface DeliverySetupStore {
  /** Deliveries with a rider assigned or on the way, oldest first. */
  onTheRoad?(): Promise<LiveDelivery[]>;
  zones(): Promise<ZoneRecord[]>;
  saveZone(id: string | null, zone: Omit<ZoneRecord, "id">): Promise<void>;
  removeZone(id: string): Promise<void>;
  riders(): Promise<RiderRecord[]>;
  addRider(name: string, waId: string): Promise<void>;
  removeRider(id: string): Promise<void>;
}

export interface BankAccount {
  id: string;
  bankName: string;
  bankCode: string | null;
  accountNumber: string;
  accountName: string;
  isPrimary: boolean;
}

export interface AlertNumber {
  id: string;
  waId: string;
  name: string | null;
}

export interface ExportRow {
  ref: string;
  status: string;
  createdAt: Date;
  confirmedAt: Date | null;
  paidAt: Date | null;
  customerName: string | null;
  customerWaId: string;
  items: string;
  totalKobo: number;
}

export interface BusinessInfo {
  name: string;
  description: string | null;
  orderPrefix: string;
  ownerWaId: string | null;
  businessDetails: string | null;
  paymentDetails: string | null;
  whatsappNumber: string | null;
  sheetKey: string | null;
}

/** One customer as the Customers page shows them. */
export interface CustomerSummary {
  contactId: string;
  name: string | null;
  waId: string;
  /** Confirmed or paid orders. */
  orders: number;
  /** Money from paid orders, in hundredths. */
  spentKobo: number;
  lastOrderAt: Date;
  /** Their average rating out of 5, when they've given any. */
  rating: number | null;
}

/** Everything else for one business (and, for counts, its branches). */
export interface BusinessData {
  /** Everyone who has confirmed an order in the last year, biggest spenders first. */
  customers?(): Promise<CustomerSummary[]>;
  info(): Promise<BusinessInfo | null>;
  saveInfo(info: Omit<BusinessInfo, "sheetKey" | "orderPrefix" | "paymentDetails">): Promise<void>;
  /** Customers' ratings given since then (migration 0054): how many, the average out of 5, and how many said "not good". */
  ratings?(since: Date): Promise<{ count: number; average: number | null; bad: number }>;
  /** What the owner wrote about the business and its opening hours (migration 0054). */
  about?(): Promise<BusinessAbout | null>;
  saveAbout?(text: string | null, hours: OpeningHours | null): Promise<void>;
  /** The bot's language, the currency prices are in, and voice replies (migration 0051). */
  saveLanguage(settings: { language: Lang; currency: Currency; voiceReplies: boolean }): Promise<void>;
  /** A new key for the Google Sheets link; the old link stops working. */
  newSheetKey(): Promise<string>;
  banks(): Promise<BankAccount[]>;
  addBank(account: Omit<BankAccount, "id" | "isPrimary">): Promise<void>;
  removeBank(id: string): Promise<void>;
  /** Prints this account on invoices. */
  setPrimaryBank(id: string): Promise<void>;
  alertNumbers(): Promise<AlertNumber[]>;
  addAlertNumber(waId: string, name: string | null): Promise<void>;
  removeAlertNumber(id: string): Promise<void>;
  /** When each order was confirmed, since then. */
  confirmedSince(since: Date): Promise<Date[]>;
  /** Best sellers since then: name, pieces and money, most money first. */
  topItems(since: Date, limit: number): Promise<Array<{ name: string; quantity: number; totalKobo: number }>>;
  /** Customers who messaged, and messages in and out, since then. */
  chatCounts(since: Date): Promise<{ customers: number; inbound: number; outbound: number }>;
  /** Orders created in [from, to), oldest first, for exports. */
  exportRows(from: Date, to: Date): Promise<ExportRow[]>;
}

const one = <T>(data: T | null, error: { message: string; code?: string } | null, what: string): T | null => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return data;
};

type UserRow = {
  id: string;
  business_id: string;
  wa_id: string;
  name: string | null;
  role: Role;
  password_hash: string | null;
  session_epoch: number;
  active: boolean;
  last_login_at: string | null;
};
const USER_COLUMNS = "id, business_id, wa_id, name, role, password_hash, session_epoch, active, last_login_at";
const toUser = (r: UserRow): AppUser => ({
  id: r.id,
  businessId: r.business_id,
  waId: r.wa_id,
  name: r.name,
  role: r.role,
  passwordHash: r.password_hash,
  sessionEpoch: r.session_epoch,
  active: r.active,
  lastLoginAt: r.last_login_at ? new Date(r.last_login_at) : null,
});

export function createSupabaseUsers(db: SupabaseClient): UserStore {
  const bump = async (column: "wa_id" | "id", value: string, extra: Record<string, unknown> = {}) => {
    // No SQL "epoch + 1" through the client: read, then write each row.
    const { data, error } = await db.from("app_users").select("id, session_epoch").eq(column, value);
    if (error) throw new Error(`app_users read failed: ${error.message}`);
    for (const r of data ?? []) {
      const { error: e } = await db
        .from("app_users")
        .update({ session_epoch: Number(r.session_epoch) + 1, ...extra })
        .eq("id", r.id as string);
      if (e) throw new Error(`app_users update failed: ${e.message}`);
    }
  };
  return {
    async get(id) {
      const { data, error } = await db.from("app_users").select(USER_COLUMNS).eq("id", id).maybeSingle();
      const row = one(data, error, "app user lookup");
      return row ? toUser(row as UserRow) : null;
    },
    async byWaId(waId) {
      const { data, error } = await db.from("app_users").select(USER_COLUMNS).eq("wa_id", waId).eq("active", true).order("created_at");
      return (one(data, error, "app users by number") ?? []).map((r) => toUser(r as UserRow));
    },
    async ensureOwner(businessId, waId) {
      const { data, error } = await db
        .from("app_users")
        .upsert({ business_id: businessId, wa_id: waId, role: "owner", active: true }, { onConflict: "business_id,wa_id" })
        .select(USER_COLUMNS)
        .single();
      return toUser(one(data, error, "ensureOwner") as UserRow);
    },
    async team(businessId) {
      const { data, error } = await db.from("app_users").select(USER_COLUMNS).eq("business_id", businessId).eq("active", true).order("created_at");
      return (one(data, error, "team") ?? []).map((r) => toUser(r as UserRow));
    },
    async addStaff(businessId, waId, name) {
      const { data, error } = await db
        .from("app_users")
        .upsert({ business_id: businessId, wa_id: waId, name, role: "staff", active: true }, { onConflict: "business_id,wa_id" })
        .select(USER_COLUMNS)
        .single();
      return toUser(one(data, error, "addStaff") as UserRow);
    },
    async removeStaff(businessId, userId) {
      const { data, error } = await db
        .from("app_users")
        .select("id")
        .eq("id", userId)
        .eq("business_id", businessId)
        .eq("role", "staff")
        .maybeSingle();
      if (!one(data, error, "removeStaff")) return;
      await bump("id", userId, { active: false });
    },
    async setPassword(waId, hash) {
      await bump("wa_id", waId, { password_hash: hash });
    },
    async bumpEpoch(waId) {
      await bump("wa_id", waId);
    },
    async touchLogin(userId) {
      const { error } = await db.from("app_users").update({ last_login_at: new Date().toISOString() }).eq("id", userId);
      if (error) throw new Error(`touchLogin failed: ${error.message}`);
    },
    async saveToken(userId, hash, expires) {
      const { error } = await db.from("app_login_tokens").insert({ token_hash: hash, user_id: userId, expires_at: expires.toISOString() });
      if (error) throw new Error(`saveToken failed: ${error.message}`);
    },
    async useToken(hash, now) {
      // One update that only matches an unused, unexpired link, so two clicks can't both log in.
      const { data, error } = await db
        .from("app_login_tokens")
        .update({ used_at: now.toISOString() })
        .eq("token_hash", hash)
        .is("used_at", null)
        .gt("expires_at", now.toISOString())
        .select("user_id");
      const rows = one(data, error, "useToken") ?? [];
      return rows.length ? (rows[0]!.user_id as string) : null;
    },
  };
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category?: string | null;
  unit?: string | null;
  lead_time_days?: number | null;
  photo_path?: string | null;
  active: boolean;
  created_at: string;
  quote_variants: Array<{
    id: string;
    name: string;
    min_quantity: number;
    stock?: number | null;
    active: boolean;
    created_at: string;
    quote_price_tiers: Array<{ min_quantity: number; unit_price_kobo: number | string }>;
  }>;
};

function toProduct(p: ProductRow): ProductRecord {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category ?? null,
    unit: p.unit ?? null,
    leadTimeDays: p.lead_time_days ?? null,
    photoPath: p.photo_path ?? null,
    active: p.active,
    options: p.quote_variants
      .filter((v) => v.active)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((v) => ({
        id: v.id,
        name: v.name,
        minQuantity: v.min_quantity,
        stock: v.stock ?? null,
        tiers: v.quote_price_tiers
          .map((t) => ({ minQuantity: t.min_quantity, unitPriceKobo: Number(t.unit_price_kobo) }))
          .sort((a, b) => a.minQuantity - b.minQuantity),
      })),
  };
}

const PRODUCT_SELECT =
  "id, name, description, category, unit, lead_time_days, photo_path, active, created_at, quote_variants(id, name, min_quantity, stock, active, created_at, quote_price_tiers(min_quantity, unit_price_kobo))";

export function createSupabasePrices(db: SupabaseClient, businessId: string): PriceStore {
  async function product(id: string): Promise<ProductRecord | null> {
    const { data, error } = await db.from("quote_products").select(PRODUCT_SELECT).eq("business_id", businessId).eq("id", id).maybeSingle();
    const row = one(data, error, "product");
    return row ? toProduct(row as unknown as ProductRow) : null;
  }

  return {
    async products() {
      const { data, error } = await db
        .from("quote_products")
        .select(PRODUCT_SELECT)
        .eq("business_id", businessId)
        .eq("active", true)
        .order("name");
      return ((one(data, error, "products") ?? []) as unknown as ProductRow[]).map(toProduct);
    },

    product,

    async save(id, input) {
      for (const o of input.options) for (const t of o.tiers) assertKobo(t.unitPriceKobo, "price");
      const now = new Date().toISOString();
      const fields = {
        name: input.name,
        slug: productSlug(input.name),
        description: input.description,
        category: input.category,
        unit: input.unit,
        lead_time_days: input.leadTimeDays,
        active: input.active,
        updated_at: now,
      };
      let productId = id;
      if (productId) {
        const { data, error } = await db.from("quote_products").update(fields).eq("id", productId).eq("business_id", businessId).select("id");
        if (error?.code === "23505") throw new DuplicateProductError(input.name);
        if (!(one(data, error, "save product") ?? []).length) throw new Error("save product: not this business's product");
      } else {
        // A product with this name that was taken off earlier comes back instead.
        const { data: old } = await db.from("quote_products").select("id").eq("business_id", businessId).eq("slug", fields.slug).maybeSingle();
        if (old) {
          productId = old.id as string;
          const { error } = await db.from("quote_products").update(fields).eq("id", productId);
          if (error) throw new Error(`revive product failed: ${error.message}`);
        } else {
          const { data, error } = await db.from("quote_products").insert({ ...fields, business_id: businessId }).select("id").single();
          if (error?.code === "23505") throw new DuplicateProductError(input.name);
          productId = (one(data, error, "add product") as { id: string }).id;
        }
      }

      // Options: match by id, else by name (a removed option comes back), else new.
      const { data: existing, error: vErr } = await db.from("quote_variants").select("id, name").eq("product_id", productId);
      const variants = (one(existing, vErr, "options") ?? []) as Array<{ id: string; name: string }>;
      const kept = new Set<string>();
      for (const o of input.options) {
        const match =
          variants.find((v) => o.id && v.id === o.id) ?? variants.find((v) => v.name.toLowerCase() === o.name.toLowerCase() && !kept.has(v.id));
        const row = { name: o.name, min_quantity: o.minQuantity, stock: o.stock, active: true, updated_at: now };
        let variantId: string;
        if (match) {
          const { error } = await db.from("quote_variants").update(row).eq("id", match.id);
          if (error) throw new Error(`save option failed: ${error.message}`);
          variantId = match.id;
        } else {
          const { data, error } = await db.from("quote_variants").insert({ ...row, product_id: productId }).select("id").single();
          variantId = (one(data, error, "add option") as { id: string }).id;
        }
        kept.add(variantId);
        const { error: delErr } = await db.from("quote_price_tiers").delete().eq("variant_id", variantId);
        if (delErr) throw new Error(`clear prices failed: ${delErr.message}`);
        if (o.tiers.length) {
          const { error } = await db
            .from("quote_price_tiers")
            .insert(o.tiers.map((t) => ({ variant_id: variantId, min_quantity: t.minQuantity, unit_price_kobo: t.unitPriceKobo })));
          if (error) throw new Error(`save prices failed: ${error.message}`);
        }
      }
      const dropped = variants.filter((v) => !kept.has(v.id)).map((v) => v.id);
      if (dropped.length) {
        const { error } = await db.from("quote_variants").update({ active: false, updated_at: now }).in("id", dropped);
        if (error) throw new Error(`switch off options failed: ${error.message}`);
      }
      return productId!;
    },

    async remove(id) {
      const { error } = await db
        .from("quote_products")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("business_id", businessId);
      if (error) throw new Error(`remove product failed: ${error.message}`);
    },
  };
}

export function createSupabaseDeliverySetup(db: SupabaseClient, businessId: string, trackLink?: (deliveryId: string) => string): DeliverySetupStore {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    async onTheRoad() {
      const { data, error } = await db
        .from("quote_deliveries")
        .select("id, order_ref, status, rider_name, rider_wa_id, customer_name, customer_wa_id, address, lat, lng, rider_lat, rider_lng, rider_seen_at, assigned_at")
        .eq("business_id", businessId)
        .in("status", ["assigned", "picked_up"])
        .order("assigned_at", { ascending: true })
        .limit(50);
      return (one(data, error, "deliveries on the road") ?? []).map((d) => {
        const lat = num(d.lat), lng = num(d.lng), rLat = num(d.rider_lat), rLng = num(d.rider_lng);
        return {
          id: d.id as string,
          orderRef: d.order_ref as string,
          status: d.status as LiveDelivery["status"],
          riderName: (d.rider_name as string | null) ?? null,
          riderWaId: (d.rider_wa_id as string | null) ?? null,
          customerName: (d.customer_name as string | null) ?? null,
          customerWaId: d.customer_wa_id as string,
          address: (d.address as string | null) ?? null,
          drop: lat !== null && lng !== null ? { lat, lng } : null,
          rider: rLat !== null && rLng !== null && d.rider_seen_at ? { lat: rLat, lng: rLng, seenAt: new Date(d.rider_seen_at as string) } : null,
          assignedAt: d.assigned_at ? new Date(d.assigned_at as string) : null,
          ...(trackLink ? { trackLink: trackLink(d.id as string) } : {}),
        };
      });
    },
    async zones() {
      const { data, error } = await db
        .from("quote_delivery_zones")
        .select("id, name, areas, fee_kobo")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("fee_kobo");
      return (one(data, error, "zones") ?? []).map((z) => ({
        id: z.id as string,
        name: z.name as string,
        areas: (z.areas as string[]) ?? [],
        feeKobo: Number(z.fee_kobo),
      }));
    },
    async saveZone(id, zone) {
      const row = { name: zone.name, areas: zone.areas.map((a) => a.toLowerCase()), fee_kobo: assertKobo(zone.feeKobo, "fee") };
      const { error } = id
        ? await db.from("quote_delivery_zones").update(row).eq("id", id).eq("business_id", businessId)
        : await db.from("quote_delivery_zones").insert({ ...row, business_id: businessId });
      if (error) throw new Error(`save zone failed: ${error.message}`);
    },
    async removeZone(id) {
      const { error } = await db.from("quote_delivery_zones").update({ active: false }).eq("id", id).eq("business_id", businessId);
      if (error) throw new Error(`remove zone failed: ${error.message}`);
    },
    async riders() {
      const { data, error } = await db.from("quote_riders").select("id, name, wa_id").eq("business_id", businessId).eq("active", true).order("name");
      return (one(data, error, "riders") ?? []).map((r) => ({ id: r.id as string, name: r.name as string, waId: r.wa_id as string }));
    },
    async addRider(name, waId) {
      const { error } = await db
        .from("quote_riders")
        .upsert({ business_id: businessId, name, wa_id: waId, active: true }, { onConflict: "business_id,wa_id" });
      if (error) throw new Error(`add rider failed: ${error.message}`);
    },
    async removeRider(id) {
      const { error } = await db.from("quote_riders").update({ active: false }).eq("id", id).eq("business_id", businessId);
      if (error) throw new Error(`remove rider failed: ${error.message}`);
    },
  };
}

/** The bank details printed on invoices, from the account the owner picked. */
export function paymentDetailsText(a: Pick<BankAccount, "bankName" | "accountNumber" | "accountName">): string {
  return `Bank: ${a.bankName}\nAccount number: ${a.accountNumber}\nAccount name: ${a.accountName}`;
}

/**
 * `businessIds` are the business and its branches (for counts and exports);
 * `numberIds` the WhatsApp numbers its chats are on ("" for messages saved
 * without one, on the main number).
 */
export function createSupabaseBusinessData(
  db: SupabaseClient,
  opts: { businessId: string; businessIds: string[]; numberIds: string[]; orderPrefix: string },
): BusinessData {
  const id = opts.businessId;
  const numbers = (q: any) => {
    const real = opts.numberIds.filter(Boolean);
    const filters = [real.length ? `business_number_id.in.(${real.join(",")})` : "", opts.numberIds.includes("") ? "business_number_id.is.null" : ""].filter(Boolean);
    return q.or(filters.join(","));
  };

  return {
    async info() {
      const { data, error } = await db.from("quote_businesses").select("*").eq("id", id).maybeSingle();
      const r = one(data, error, "business info") as Record<string, unknown> | null;
      if (!r) return null;
      return {
        name: r.name as string,
        description: (r.description as string | null) ?? null,
        orderPrefix: r.order_prefix as string,
        ownerWaId: (r.owner_wa_id as string | null) ?? null,
        businessDetails: (r.business_details as string | null) ?? null,
        paymentDetails: (r.payment_details as string | null) ?? null,
        whatsappNumber: (r.whatsapp_number as string | null) ?? null,
        sheetKey: (r.sheet_key as string | null) ?? null,
      };
    },
    async saveInfo(info) {
      const { error } = await db
        .from("quote_businesses")
        .update({
          name: info.name,
          description: info.description,
          owner_wa_id: info.ownerWaId,
          business_details: info.businessDetails,
          whatsapp_number: info.whatsappNumber,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(`save business info failed: ${error.message}`);
    },
    about: createSupabaseAbout(db, id),
    async saveAbout(text, hours) {
      const { error } = await db.from("quote_businesses").update({ about: text, opening_hours: hours, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(`save about failed: ${error.message}`);
    },
    async saveLanguage(settings) {
      const { error } = await db
        .from("quote_businesses")
        // updated_at makes the bot pick the change up straight away.
        .update({ language: settings.language, currency: settings.currency, voice_replies: settings.voiceReplies, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`save language failed: ${error.message}`);
    },
    async newSheetKey() {
      const key = crypto.randomUUID().replace(/-/g, "");
      const { error } = await db.from("quote_businesses").update({ sheet_key: key }).eq("id", id);
      if (error) throw new Error(`newSheetKey failed: ${error.message}`);
      return key;
    },
    async banks() {
      const { data, error } = await db.from("quote_bank_accounts").select("*").eq("business_id", id).order("created_at");
      return (one(data, error, "banks") ?? []).map((b) => ({
        id: b.id as string,
        bankName: b.bank_name as string,
        bankCode: (b.bank_code as string | null) ?? null,
        accountNumber: b.account_number as string,
        accountName: b.account_name as string,
        isPrimary: b.is_primary as boolean,
      }));
    },
    async addBank(a) {
      const { count } = await db.from("quote_bank_accounts").select("id", { count: "exact", head: true }).eq("business_id", id);
      const first = !count;
      const { error } = await db.from("quote_bank_accounts").insert({
        business_id: id,
        bank_name: a.bankName,
        bank_code: a.bankCode,
        account_number: a.accountNumber,
        account_name: a.accountName,
        is_primary: first,
      });
      if (error) throw new Error(error.code === "23505" ? "That account is already saved." : `add bank failed: ${error.message}`);
      if (first) await setInvoiceDetails(a);
    },
    async removeBank(bankId) {
      const { error } = await db.from("quote_bank_accounts").delete().eq("id", bankId).eq("business_id", id);
      if (error) throw new Error(`remove bank failed: ${error.message}`);
    },
    async setPrimaryBank(bankId) {
      const { data, error } = await db.from("quote_bank_accounts").select("*").eq("id", bankId).eq("business_id", id).maybeSingle();
      const b = one(data, error, "bank lookup");
      if (!b) return;
      // Clear first: only one primary account is allowed at a time.
      const clear = await db.from("quote_bank_accounts").update({ is_primary: false }).eq("business_id", id);
      if (clear.error) throw new Error(`setPrimaryBank failed: ${clear.error.message}`);
      const set = await db.from("quote_bank_accounts").update({ is_primary: true }).eq("id", bankId);
      if (set.error) throw new Error(`setPrimaryBank failed: ${set.error.message}`);
      await setInvoiceDetails({ bankName: b.bank_name, accountNumber: b.account_number, accountName: b.account_name });
    },
    async alertNumbers() {
      const { data, error } = await db.from("quote_alert_numbers").select("id, wa_id, name").eq("business_id", id).order("created_at");
      return (one(data, error, "alert numbers") ?? []).map((a) => ({ id: a.id as string, waId: a.wa_id as string, name: (a.name as string | null) ?? null }));
    },
    async addAlertNumber(waId, name) {
      const { error } = await db.from("quote_alert_numbers").upsert({ business_id: id, wa_id: waId, name }, { onConflict: "business_id,wa_id" });
      if (error) throw new Error(`add alert number failed: ${error.message}`);
    },
    async removeAlertNumber(alertId) {
      const { error } = await db.from("quote_alert_numbers").delete().eq("id", alertId).eq("business_id", id);
      if (error) throw new Error(`remove alert number failed: ${error.message}`);
    },
    async confirmedSince(since) {
      const { data, error } = await db
        .from("quote_orders")
        .select("confirmed_at")
        .in("business_id", opts.businessIds)
        .gte("confirmed_at", since.toISOString())
        .neq("status", "cancelled")
        .limit(10_000);
      return (one(data, error, "confirmedSince") ?? []).map((r) => new Date(r.confirmed_at as string));
    },
    async topItems(since, limit) {
      const { data, error } = await db
        .from("quote_order_items")
        .select("name, quantity, total_kobo, quote_orders!inner(business_id, status, confirmed_at)")
        .in("quote_orders.business_id", opts.businessIds)
        .in("quote_orders.status", ["confirmed", "paid"])
        .gte("quote_orders.confirmed_at", since.toISOString())
        .limit(10_000);
      const totals = new Map<string, { name: string; quantity: number; totalKobo: number }>();
      for (const r of one(data, error, "topItems") ?? []) {
        const t = totals.get(r.name as string) ?? { name: r.name as string, quantity: 0, totalKobo: 0 };
        t.quantity += Number(r.quantity);
        t.totalKobo += Number(r.total_kobo);
        totals.set(t.name, t);
      }
      return [...totals.values()].sort((a, b) => b.totalKobo - a.totalKobo).slice(0, limit);
    },
    async customers() {
      const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
      const { data, error } = await db
        .from("quote_orders")
        .select("contact_id, status, total_kobo, confirmed_at, rating, contacts(wa_id, name)")
        .in("business_id", opts.businessIds)
        .in("status", ["confirmed", "paid"])
        .gte("confirmed_at", since)
        .order("confirmed_at", { ascending: false })
        .limit(10_000);
      const byContact = new Map<string, CustomerSummary & { stars: number[] }>();
      for (const r of one(data, error, "customers") ?? []) {
        const contact = (Array.isArray(r.contacts) ? r.contacts[0] : r.contacts) as { wa_id?: string; name?: string | null } | null;
        if (!contact?.wa_id || !r.confirmed_at) continue;
        const id = r.contact_id as string;
        const c = byContact.get(id) ?? { contactId: id, name: contact.name ?? null, waId: contact.wa_id, orders: 0, spentKobo: 0, lastOrderAt: new Date(r.confirmed_at as string), rating: null, stars: [] };
        c.orders++;
        if (r.status === "paid") c.spentKobo += Number(r.total_kobo);
        if (r.rating != null) c.stars.push(Number(r.rating));
        byContact.set(id, c);
      }
      return [...byContact.values()]
        .map(({ stars, ...c }) => ({ ...c, rating: stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : null }))
        .sort((a, b) => b.spentKobo - a.spentKobo || b.orders - a.orders);
    },
    async ratings(since) {
      const { data, error } = await db
        .from("quote_orders")
        .select("rating")
        .in("business_id", opts.businessIds)
        .not("rating", "is", null)
        .gte("rated_at", since.toISOString())
        .limit(10_000);
      const stars = (one(data, error, "ratings") ?? []).map((r) => Number(r.rating));
      const total = stars.reduce((a, b) => a + b, 0);
      return { count: stars.length, average: stars.length ? Math.round((total / stars.length) * 10) / 10 : null, bad: stars.filter((x) => x <= 1).length };
    },
    async chatCounts(since) {
      const base = () => numbers(db.from("messages").select("contact_id", { count: "exact" }).gte("created_at", since.toISOString()));
      const [inbound, outbound] = await Promise.all([base().eq("direction", "inbound").limit(5000), base().eq("direction", "outbound").limit(1)]);
      if (inbound.error) throw new Error(`chatCounts failed: ${inbound.error.message}`);
      if (outbound.error) throw new Error(`chatCounts failed: ${outbound.error.message}`);
      const customers = new Set(((inbound.data ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id)).size;
      return { customers, inbound: inbound.count ?? 0, outbound: outbound.count ?? 0 };
    },
    async exportRows(from, to) {
      const { data, error } = await db
        .from("quote_orders")
        .select("order_number, status, created_at, confirmed_at, paid_at, total_kobo, contacts(wa_id, name), quote_order_items(name, quantity)")
        .in("business_id", opts.businessIds)
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at")
        .limit(20_000);
      type Row = {
        order_number: number | string;
        status: string;
        created_at: string;
        confirmed_at: string | null;
        paid_at: string | null;
        total_kobo: number | string;
        contacts: { wa_id: string; name: string | null };
        quote_order_items: Array<{ name: string; quantity: number }>;
      };
      return ((one(data, error, "exportRows") ?? []) as unknown as Row[]).map((r) => ({
        ref: `${opts.orderPrefix}-${r.order_number}`,
        status: r.status,
        createdAt: new Date(r.created_at),
        confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : null,
        paidAt: r.paid_at ? new Date(r.paid_at) : null,
        customerName: r.contacts?.name ?? null,
        customerWaId: r.contacts?.wa_id ?? "",
        items: r.quote_order_items.map((i) => `${i.quantity} x ${i.name}`).join(", "),
        totalKobo: Number(r.total_kobo),
      }));
    },
  };

  async function setInvoiceDetails(a: Pick<BankAccount, "bankName" | "accountNumber" | "accountName">) {
    const { error } = await db
      .from("quote_businesses")
      .update({ payment_details: paymentDetailsText(a), updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`invoice bank details failed: ${error.message}`);
  }
}
