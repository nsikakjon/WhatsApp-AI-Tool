import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "../../core/product.js";
import type { BusinessStore, QuoteBusiness } from "./store.js";

// Partners on yarnOga's quotes line, for a shop with no WhatsApp number of its
// own (migration 0090). Each such shop has a keyword, e.g. "tedxuniuyo", set
// on the dashboard's Partnerships page. A visitor who sends the keyword (or
// taps a link that types it for them) chats with that shop's bot on our line:
// its FAQs, prices, tickets and pay links. They stay with it until they send
// "exit", another shop's keyword, or "sign up", or go quiet for IDLE_DAYS.
// Everyone else gets the line as before: the Demo Shop and sign-up.
//
// A keyword is never taken from someone part way through signing up, so the
// same word can still be typed as a promo code at the referral question.

export const IDLE_DAYS = 14;
const IDLE_MS = IDLE_DAYS * 24 * 60 * 60 * 1000;
const EXIT = /^(exit|leave|quit chat|back to yarnoga)[.!]*$/i;
const SIGN_UP = /\b(sign\s*-?\s*up|register)\b/i;
/** Only short messages are checked for a keyword ("TEDxUNIUYO", "hi tedxuniuyo"). */
const KEYWORD_MAX_WORDS = 4;

export interface LineGuest {
  businessId: string;
  lastAt: Date;
}

export interface LineGuestStore {
  /** Keyword -> business id, for every shop that has one. */
  keywords(): Promise<Map<string, string>>;
  current(waId: string, numberId: string): Promise<LineGuest | null>;
  /** Puts the visitor with this shop (or none), as of `at`. */
  set(waId: string, numberId: string, businessId: string | null, at: Date): Promise<void>;
}

export interface SharedLineOptions {
  /** Phone number ID of the yarnOga quotes line. Messages to other numbers pass straight through. */
  numberId: string;
  store: LineGuestStore;
  businesses: Pick<BusinessStore, "get">;
  /** The shop's bot, as it would run on its own number. */
  build(business: QuoteBusiness): Product;
  /** True while this person is part way through signing up, so their words aren't taken as keywords. */
  busy?(waId: string): Promise<boolean>;
  now?: () => Date;
  log?: Pick<Console, "error">;
  /** How long to remember the keyword list (default a minute). */
  cacheMs?: number;
}

/** "Hi TEDxUNIUYO!" -> the keyword it names, if any. */
export function keywordIn(text: string, keywords: Map<string, string>): string | null {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.length > KEYWORD_MAX_WORDS) return null;
  return words.find((w) => keywords.has(w)) ?? null;
}

/** A keyword from what was typed on the dashboard: letters and numbers, lower case. */
export function cleanKeyword(text: string): string | null {
  const k = text.trim().toLowerCase().replace(/[\s-]+/g, "");
  return /^[a-z0-9]{3,30}$/.test(k) ? k : null;
}

export function withSharedLine(next: Product, opts: SharedLineOptions): Product {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;
  const cacheMs = opts.cacheMs ?? 60_000;
  let cached: { at: number; map: Map<string, string> } | null = null;
  const bots = new Map<string, { product: Product; updatedAt: number }>();

  async function keywords(): Promise<Map<string, string>> {
    if (cached && now().getTime() - cached.at < cacheMs) return cached.map;
    cached = { at: now().getTime(), map: await opts.store.keywords() };
    return cached.map;
  }

  function botFor(business: QuoteBusiness): Product {
    const existing = bots.get(business.id);
    if (existing && existing.updatedAt === business.updatedAt.getTime()) return existing.product;
    const product = opts.build(business);
    bots.set(business.id, { product, updatedAt: business.updatedAt.getTime() });
    return product;
  }

  return {
    name: next.name,
    async handle(msg, ctx) {
      if (msg.businessNumberId !== opts.numberId) return next.handle(msg, ctx);
      const text = (msg.text ?? "").trim();
      const at = now();
      try {
        const known = await keywords();
        const keyword = text ? keywordIn(text, known) : null;
        if (keyword && !(await opts.busy?.(msg.from))) {
          const business = await opts.businesses.get(known.get(keyword)!);
          if (business) {
            await opts.store.set(msg.from, opts.numberId, business.id, at);
            return botFor(business).handle({ ...msg, text: "hi" }, ctx);
          }
        }

        const guest = await opts.store.current(msg.from, opts.numberId);
        if (guest && at.getTime() - guest.lastAt.getTime() < IDLE_MS) {
          const business = await opts.businesses.get(guest.businessId);
          if (business && EXIT.test(text)) {
            await opts.store.set(msg.from, opts.numberId, null, at);
            const back = business.lineKeyword ? ` Send *${business.lineKeyword.toUpperCase()}* to go back.` : "";
            return { text: `You've left the ${business.name} chat.${back}` };
          }
          if (business && !SIGN_UP.test(text)) {
            await opts.store.set(msg.from, opts.numberId, business.id, at);
            return botFor(business).handle(msg, ctx);
          }
          await opts.store.set(msg.from, opts.numberId, null, at);
        }
      } catch (err) {
        // Most likely migration 0090 hasn't been run yet: the line carries on as before.
        log.error("Shared line lookup failed:", err);
      }
      return next.handle(msg, ctx);
    },
  };
}

export function createSupabaseLineGuests(db: SupabaseClient): LineGuestStore {
  return {
    async keywords() {
      const { data, error } = await db.from("quote_businesses").select("id, line_keyword").not("line_keyword", "is", null);
      if (error) throw new Error(`line keywords failed: ${error.message}`);
      return new Map((data ?? []).map((r) => [r.line_keyword as string, r.id as string]));
    },
    async current(waId, numberId) {
      const { data, error } = await db
        .from("quote_line_guests")
        .select("business_id, last_at")
        .eq("wa_id", waId)
        .eq("number_id", numberId)
        .is("left_at", null)
        .order("last_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`line guest failed: ${error.message}`);
      return data ? { businessId: data.business_id as string, lastAt: new Date(data.last_at as string) } : null;
    },
    async set(waId, numberId, businessId, at) {
      let leave = db.from("quote_line_guests").update({ left_at: at.toISOString() }).eq("wa_id", waId).eq("number_id", numberId).is("left_at", null);
      if (businessId) leave = leave.neq("business_id", businessId);
      const { error } = await leave;
      if (error) throw new Error(`line guest leave failed: ${error.message}`);
      if (!businessId) return;
      const { error: saveError } = await db
        .from("quote_line_guests")
        .upsert({ wa_id: waId, number_id: numberId, business_id: businessId, last_at: at.toISOString(), left_at: null }, { onConflict: "wa_id,number_id,business_id" });
      if (saveError) throw new Error(`line guest save failed: ${saveError.message}`);
    },
  };
}
