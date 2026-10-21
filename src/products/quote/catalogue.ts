import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductContext, Reply } from "../../core/product.js";
import type { OutgoingImage } from "../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { PlanFeatures } from "./features.js";
import type { QuoteLine } from "./pricing.js";

// Product photos and stock levels (QUOTE_CATALOGUE, migration 0037), on the
// plans that include "catalogue".
//
// The owner, on WhatsApp:
//   stock               lists the price list, numbered, with what's left
//   stock 3 25          item 3 has 25 left
//   stock 3 off         stop counting item 3 (made to order)
//   a photo captioned "photo T-shirts" becomes that product's photo
//
// Customers get the product photos with their quote. The bot won't quote more
// than is left of a counted item, and a confirmed order takes its quantity off.

export interface CatalogueItem {
  variantId: string;
  /** "Product: option", as on quotes. */
  name: string;
  productId: string;
  productName: string;
  /** Null when stock isn't counted for this item. */
  stock: number | null;
  photoPath: string | null;
}

export interface CatalogueStore {
  /** Every active price list row, sorted by name. */
  items(): Promise<CatalogueItem[]>;
  setStock(variantId: string, stock: number | null): Promise<void>;
  savePhoto(productId: string, data: Uint8Array, mimeType: string): Promise<void>;
  photo(path: string): Promise<OutgoingImage | null>;
  /** Takes a confirmed order's quantities off the stock. */
  takeStock(orderId: string): Promise<void>;
}

export interface Catalogue {
  /** The owner's stock and photo messages; null for anything else. */
  ownerCommand(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null>;
  /** Quote lines that ask for more than is left, with what to tell the customer. */
  shortages(lines: QuoteLine[]): Promise<Map<string, string>>;
  /** Photos of the products on a quote, at most three. */
  photos(lines: QuoteLine[]): Promise<OutgoingImage[]>;
  confirmed(orderId: string): Promise<void>;
}

const LIST_MAX = 40;
const PHOTOS_MAX = 3;

export function createCatalogue(opts: { store: CatalogueStore; features?: PlanFeatures; log?: Pick<Console, "error"> }): Catalogue {
  const log = opts.log ?? console;
  const onPlan = () => (opts.features ? opts.features.has("catalogue") : Promise.resolve(true));
  const notOnPlan: Reply = { text: "Product photos and stock levels come with Pro and above. Send *plan* to see how to upgrade." };

  async function list(filter: string): Promise<string> {
    const items = await opts.store.items();
    const shown = items
      .map((item, i) => ({ item, n: i + 1 }))
      .filter(({ item }) => !filter || item.name.toLowerCase().includes(filter.toLowerCase()));
    if (shown.length === 0) return filter ? `Nothing on your price list matches "${filter}".` : "Your price list is empty.";
    const lines = shown
      .slice(0, LIST_MAX)
      .map(({ item, n }) => `${n}. ${item.name}: ${item.stock === null ? "not counted" : `${item.stock} left`}`);
    return [
      "Stock:",
      ...lines,
      ...(shown.length > LIST_MAX ? ["", `…and ${shown.length - LIST_MAX} more. Send *stock* and a word to narrow it down, e.g. *stock shirt*.`] : []),
      "",
      "Send *stock 3 25* when item 3 has 25 left, or *stock 3 off* to stop counting it.",
    ].join("\n");
  }

  return {
    async ownerCommand(msg, ctx) {
      const caption = (msg.caption ?? "").trim().match(/^photo\s+(.+)$/i);
      if (caption && msg.type === "image" && msg.mediaId) {
        if (!(await onPlan())) return notOnPlan;
        const wanted = caption[1]!.trim().toLowerCase();
        const products = [...new Map((await opts.store.items()).map((i) => [i.productId, i.productName])).entries()];
        const exact = products.filter(([, name]) => name.toLowerCase() === wanted);
        const matches = exact.length ? exact : products.filter(([, name]) => name.toLowerCase().includes(wanted));
        if (matches.length !== 1) {
          const names = products.map(([, name]) => name).join(", ");
          return { text: `Which product is this photo for? Send it again with the caption *photo* and one of: ${names}.` };
        }
        const file = await ctx.downloadMedia(msg.mediaId);
        if (!/^image\/(jpeg|png)$/.test(file.mimeType)) return { text: "Please send the photo as a JPEG or PNG picture." };
        const [productId, name] = matches[0]!;
        await opts.store.savePhoto(productId, new Uint8Array(await file.data.arrayBuffer()), file.mimeType);
        return { text: `Photo saved for ${name} ✅ Customers will see it with their quotes.` };
      }

      const text = (msg.text ?? "").trim();
      const command = text.match(/^stock(?:\s+(.*))?$/i);
      if (!command) return null;
      if (!(await onPlan())) return notOnPlan;
      const rest = (command[1] ?? "").trim();
      const set = rest.match(/^(\d+)\s*[:=-]?\s*(\d+|off)$/i);
      if (!set) return { text: await list(rest) };

      const items = await opts.store.items();
      const item = items[Number(set[1]) - 1];
      if (!item) return { text: `There's no item ${set[1]}. Send *stock* to see the numbers.` };
      const stock = /^off$/i.test(set[2]!) ? null : Number(set[2]);
      await opts.store.setStock(item.variantId, stock);
      return { text: stock === null ? `${item.name}: no longer counted.` : `${item.name}: ${stock} left.` };
    },

    async shortages(lines) {
      const short = new Map<string, string>();
      if (!(await onPlan())) return short;
      const stock = new Map((await opts.store.items()).map((i) => [i.variantId, i.stock]));
      for (const line of lines) {
        const left = stock.get(line.variantId);
        if (left == null || line.quantity <= left) continue;
        short.set(line.variantId, left === 0 ? `${line.name} is sold out at the moment.` : `${line.name}: only ${left} left.`);
      }
      return short;
    },

    async photos(lines) {
      try {
        if (!(await onPlan())) return [];
        const wanted = new Set(lines.map((l) => l.variantId));
        const products = new Map<string, string>();
        for (const i of await opts.store.items()) if (wanted.has(i.variantId) && i.photoPath) products.set(i.photoPath, i.productName);
        const photos = await Promise.all(
          [...products].slice(0, PHOTOS_MAX).map(async ([path, name]): Promise<OutgoingImage | null> => {
            const photo = await opts.store.photo(path);
            return photo && { ...photo, caption: name };
          }),
        );
        return photos.filter((p): p is OutgoingImage => p !== null);
      } catch (err) {
        // A missing photo should never hold up a quote.
        log.error("Could not load product photos:", err);
        return [];
      }
    },

    async confirmed(orderId) {
      try {
        if (await onPlan()) await opts.store.takeStock(orderId);
      } catch (err) {
        log.error(`Could not take order ${orderId} off the stock:`, err);
      }
    },
  };
}

const FILES_BUCKET = "quote-files";

type ItemRow = {
  id: string;
  name: string;
  stock: number | null;
  quote_products: { id: string; name: string; photo_path: string | null };
};

export function createSupabaseCatalogue(db: SupabaseClient, businessId: string): CatalogueStore {
  return {
    async items() {
      const { data, error } = await db
        .from("quote_variants")
        .select("id, name, stock, quote_products!inner(id, name, photo_path, active, business_id)")
        .eq("active", true)
        .eq("quote_products.active", true)
        .eq("quote_products.business_id", businessId);
      if (error) throw new Error(`catalogue items failed: ${error.message}`);
      return ((data ?? []) as unknown as ItemRow[])
        .map((r) => ({
          variantId: r.id,
          name: `${r.quote_products.name}: ${r.name}`,
          productId: r.quote_products.id,
          productName: r.quote_products.name,
          stock: r.stock,
          photoPath: r.quote_products.photo_path,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async setStock(variantId, stock) {
      const { error } = await db.from("quote_variants").update({ stock, updated_at: new Date().toISOString() }).eq("id", variantId);
      if (error) throw new Error(`setStock failed: ${error.message}`);
    },
    async savePhoto(productId, data, mimeType) {
      const path = `businesses/${businessId}/products/${productId}`;
      const { error } = await db.storage.from(FILES_BUCKET).upload(path, data, { contentType: mimeType, upsert: true });
      if (error) throw new Error(`savePhoto failed: ${error.message}`);
      const { error: rowError } = await db
        .from("quote_products")
        .update({ photo_path: path, updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("business_id", businessId);
      if (rowError) throw new Error(`savePhoto row failed: ${rowError.message}`);
    },
    async photo(path) {
      // Sample photos (the demo shop's, from Pexels) are web addresses rather than stored files.
      if (path.startsWith("https://")) {
        const res = await fetch(path, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return null;
        return { data: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") === "image/png" ? "image/png" : "image/jpeg" };
      }
      const { data, error } = await db.storage.from(FILES_BUCKET).download(path);
      if (error || !data) return null;
      return { data: new Uint8Array(await data.arrayBuffer()), mimeType: data.type === "image/png" ? "image/png" : "image/jpeg" };
    },
    async takeStock(orderId) {
      const { error } = await db.rpc("quote_take_stock", { p_order_id: orderId });
      if (error) throw new Error(`takeStock failed: ${error.message}`);
    },
  };
}
