import type { Product } from "../../core/product.js";
import type { BusinessStore, QuoteBusiness } from "./store.js";

// Several businesses on one quote bot. Each business has its own WhatsApp
// number; a message to that number is answered by a quote bot set up with
// that business's name, price list, orders and owner alert number. Messages
// to any other number go to `fallback` (business #1 on the main number, or
// whatever ACTIVE_PRODUCT is), exactly as before.

export interface QuoteRouterOptions {
  businesses: BusinessStore;
  /** Builds the quote bot for one business. Called again when its settings change. */
  build(business: QuoteBusiness): Product;
  /** Answers messages to numbers that don't belong to a business. */
  fallback: Product;
  /**
   * Numbers that always go to `fallback`, whatever the businesses table says
   * (the main number), so a mistyped row can never take over its customers.
   */
  fallbackNumberIds?: string[];
  /** How long to remember which business a number belongs to (default 60 seconds). */
  cacheMs?: number;
  now?: () => number;
  log?: Pick<Console, "error">;
}

export function createQuoteRouter(opts: QuoteRouterOptions): Product {
  const cacheMs = opts.cacheMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console;
  const lookups = new Map<string, { business: QuoteBusiness | null; at: number }>();
  const built = new Map<string, { product: Product; updatedAt: number }>();

  async function businessFor(phoneNumberId: string): Promise<QuoteBusiness | null> {
    const cached = lookups.get(phoneNumberId);
    if (cached && now() - cached.at < cacheMs) return cached.business;
    const business = await opts.businesses.findByPhoneNumberId(phoneNumberId);
    lookups.set(phoneNumberId, { business, at: now() });
    return business;
  }

  function productFor(business: QuoteBusiness): Product {
    const existing = built.get(business.id);
    if (existing && existing.updatedAt === business.updatedAt.getTime()) return existing.product;
    const product = opts.build(business);
    built.set(business.id, { product, updatedAt: business.updatedAt.getTime() });
    return product;
  }

  return {
    name: "quote",
    async handle(msg, ctx) {
      let business: QuoteBusiness | null = null;
      if (msg.businessNumberId && !opts.fallbackNumberIds?.includes(msg.businessNumberId)) {
        try {
          business = await businessFor(msg.businessNumberId);
        } catch (err) {
          // Most likely migration 0020 hasn't been run yet. Carry on as before.
          log.error("Could not look up the business for this number:", err);
        }
      }
      if (!business) return opts.fallback.handle(msg, ctx);
      // A switched-off business's number gets no answer, never another business's.
      if (!business.active) return null;
      return productFor(business).handle(msg, ctx);
    },
  };
}
