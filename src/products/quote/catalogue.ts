import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "../../core/i18n.js";
import { formatMoney, type Currency } from "../../core/money.js";
import type { ProductContext, Reply } from "../../core/product.js";
import type { OutgoingButtons, OutgoingImage } from "../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { PlanFeatures } from "./features.js";
import { quoteLine, type QuoteLine, type Variant } from "./pricing.js";

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
//
// A customer who asks for the catalogue (or about one product) gets a card per
// product: its photo, its options with prices from the price list, its
// description and an "Order this" button. Five cards at a time, then "See more".

/** At or below this many left, an item is running low (the same as the app's "low stock" tag). */
export const LOW_STOCK = 5;

export interface CatalogueItem {
  variantId: string;
  /** "Product: option", as on quotes. */
  name: string;
  productId: string;
  productName: string;
  productDescription: string | null;
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
  shortages(lines: QuoteLine[], lang?: Lang): Promise<Map<string, string>>;
  /** Photos of the products on a quote, at most three. */
  photos(lines: QuoteLine[]): Promise<OutgoingImage[]>;
  /**
   * Takes a confirmed order off the stock. Returns the items this order took
   * down to the low line (LOW_STOCK) or sold out, for the owner's alert;
   * each crossing is reported once, by the order that caused it.
   */
  confirmed(orderId: string, lines?: QuoteLine[]): Promise<Array<{ name: string; left: number }>>;
  /**
   * A page of product cards, priced from `variants`. `only` narrows it to the
   * products of those variant ids. Null when there's nothing to show.
   */
  cards(variants: Variant[], page: number, only?: string[], lang?: Lang): Promise<Reply | null>;
}

const LIST_MAX = 40;
const PHOTOS_MAX = 3;
const CARDS_PER_PAGE = 5;
const OPTIONS_PER_CARD = 6;

/** The "See more" button's id, which comes back as the customer's message. */
export const CARDS_PAGE = /^catalogue page (\d{1,3})$/i;

export function createCatalogue(opts: {
  store: CatalogueStore;
  features?: PlanFeatures;
  /** What prices on the cards are in (default naira). */
  currency?: Currency;
  log?: Pick<Console, "error">;
}): Catalogue {
  const money = (minor: number) => formatMoney(minor, opts.currency ?? "NGN");
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

    async shortages(lines, lang = "en") {
      const short = new Map<string, string>();
      if (!(await onPlan())) return short;
      const stock = new Map((await opts.store.items()).map((i) => [i.variantId, i.stock]));
      for (const line of lines) {
        const left = stock.get(line.variantId);
        if (left == null || line.quantity <= left) continue;
        short.set(
          line.variantId,
          lang === "fr"
            ? left === 0
              ? `${line.name} est épuisé pour le moment.`
              : `${line.name} : il n'en reste que ${left}.`
            : left === 0
              ? `${line.name} is sold out at the moment.`
              : `${line.name}: only ${left} left.`,
        );
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

    async cards(variants, page, only = [], lang = "en") {
      const fr = lang === "fr";
      const byId = new Map(variants.map((v) => [v.id, v]));
      const wanted = new Set(only);
      const products = new Map<string, CatalogueItem[]>();
      for (const item of await opts.store.items()) products.set(item.productId, [...(products.get(item.productId) ?? []), item]);
      const shown = [...products.values()].filter((options) => wanted.size === 0 || options.some((o) => wanted.has(o.variantId)));
      if (shown.length === 0) return null;

      const pages = Math.ceil(shown.length / CARDS_PER_PAGE);
      const current = Math.min(Math.max(page, 1), pages);
      const start = (current - 1) * CARDS_PER_PAGE;
      const withPhotos = await onPlan();
      const cards = await Promise.all(
        shown.slice(start, start + CARDS_PER_PAGE).map(async (options): Promise<OutgoingButtons> => {
          const product = options[0]!;
          const prices = options
            .slice(0, OPTIONS_PER_CARD)
            .map((o) => priceLine(o.name.slice(o.productName.length + 2), byId.get(o.variantId), money, lang));
          const more = options.length - OPTIONS_PER_CARD;
          const image = withPhotos && product.photoPath ? await cardPhoto(product.photoPath) : null;
          return {
            ...(image ? { image } : {}),
            body: [
              `*${product.productName}*`,
              ...prices,
              ...(more > 0 ? [fr ? `…et ${more} autre${more === 1 ? "" : "s"} option${more === 1 ? "" : "s"}` : `…and ${more} more option${more === 1 ? "" : "s"}`] : []),
              ...(product.productDescription?.trim() ? ["", product.productDescription.trim()] : []),
            ].join("\n"),
            buttons: [fr ? { id: `Je voudrais ${product.productName}`, title: "Commander" } : { id: `I'd like ${product.productName}`, title: "Order this" }],
          };
        }),
      );
      const shownTo = start + cards.length;
      return {
        text:
          current === 1
            ? fr
              ? "Voici ce que nous vendons. Touchez *Commander* sur ce qui vous plaît, ou dites-moi simplement ce qu'il vous faut et en quelle quantité."
              : "Here's what we sell. Tap *Order this* on anything you like, or just tell me what you need and how many."
            : "",
        cards,
        ...(current < pages
          ? {
              buttons: {
                body: fr ? `Cela fait ${shownTo} produits sur ${shown.length}.` : `That's ${shownTo} of ${shown.length} products.`,
                buttons: [{ id: `catalogue page ${current + 1}`, title: fr ? "Voir plus" : "See more" }],
              },
            }
          : {}),
      };
    },

    async confirmed(orderId, lines = []) {
      try {
        if (!(await onPlan())) return [];
        await opts.store.takeStock(orderId);
        if (!lines.length) return [];
        const stock = new Map((await opts.store.items()).map((i) => [i.variantId, i]));
        const low: Array<{ name: string; left: number }> = [];
        for (const line of lines) {
          const item = stock.get(line.variantId);
          if (!item || item.stock === null) continue;
          const before = item.stock + line.quantity;
          if ((before > LOW_STOCK && item.stock <= LOW_STOCK) || (before > 0 && item.stock <= 0)) low.push({ name: item.name, left: Math.max(0, item.stock) });
        }
        return low;
      } catch (err) {
        log.error(`Could not take order ${orderId} off the stock:`, err);
        return [];
      }
    },
  };

  async function cardPhoto(path: string): Promise<OutgoingImage | null> {
    try {
      return await opts.store.photo(path);
    } catch (err) {
      // A card without its picture is better than no card.
      log.error("Could not load a product photo for a card:", err);
      return null;
    }
  }
}

/** "White, one-colour print: ₦5,000 each, ₦4,200 each from 50 (min. 10)", priced the way a quote would be. */
function priceLine(option: string, variant: Variant | undefined, money: (minor: number) => string, lang: Lang): string {
  const fr = lang === "fr";
  const label = option ? `${option[0]!.toUpperCase()}${option.slice(1)}${fr ? " : " : ": "}` : "";
  const first = variant && quoteLine(variant, variant.minQuantity);
  if (!variant || !first?.ok) return `• ${label}${fr ? "prix sur demande" : "price on request"}`;
  const top = Math.max(...variant.tiers.map((t) => t.minQuantity));
  const bulk = top > variant.minQuantity ? quoteLine(variant, top) : null;
  return [
    `• ${label}${money(first.line.unitPriceKobo)} ${fr ? "l'unité" : "each"}`,
    bulk?.ok && bulk.line.unitPriceKobo < first.line.unitPriceKobo
      ? fr
        ? `, ${money(bulk.line.unitPriceKobo)} l'unité à partir de ${top}`
        : `, ${money(bulk.line.unitPriceKobo)} each from ${top}`
      : "",
    variant.minQuantity > 1 ? ` (min. ${variant.minQuantity})` : "",
  ].join("");
}

const FILES_BUCKET = "quote-files";

type ItemRow = {
  id: string;
  name: string;
  stock: number | null;
  quote_products: { id: string; name: string; description: string | null; photo_path: string | null };
};

export function createSupabaseCatalogue(db: SupabaseClient, businessId: string): CatalogueStore {
  return {
    async items() {
      const { data, error } = await db
        .from("quote_variants")
        .select("id, name, stock, quote_products!inner(id, name, description, photo_path, active, business_id)")
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
          productDescription: r.quote_products.description,
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
