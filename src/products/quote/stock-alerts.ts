import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "../../core/i18n.js";
import type { Product } from "../../core/product.js";

// "Tell me when it's back" (migration 0094). A sold-out option on the shop
// page has a button that opens WhatsApp with a message already typed:
//
//   Please tell me when Flyers: A5 is back in stock (ref 1a2b3c4d)
//
// The ref is the start of the option's id. The bot saves the wait and says
// so; every few minutes sendDueStockAlerts looks for options that have
// stock again and messages each waiting customer once, from the number they
// wrote to. Inside WhatsApp's 24-hour window that's a normal message;
// outside it, only with an approved Utility template (BACK_IN_STOCK_TEMPLATE_NAME),
// and without one the wait is kept until it can be sent or runs out.

const REF_LENGTH = 8;
/** Waits older than this are dropped without a message. */
export const STOCK_ALERT_DAYS = 60;

/** The message the shop page types for the customer. */
export function backInStockAsk(lang: Lang, option: string, variantId: string): string {
  const ref = variantId.replace(/-/g, "").slice(0, REF_LENGTH);
  return lang === "fr" ? `Prévenez-moi quand ${option} sera de retour (réf ${ref})` : `Please tell me when ${option} is back in stock (ref ${ref})`;
}

/** The ref in a customer's "tell me when it's back" message, or null when it isn't one. */
export function backInStockRef(text: string): string | null {
  const m = text.match(/(?:tell me when|pr[ée]venez-moi quand)[\s\S]*\(r[ée]f\.?\s*([0-9a-f]{8})\)/i);
  return m ? m[1]!.toLowerCase() : null;
}

export interface WaitingOption {
  variantId: string;
  /** "Flyers: A5" */
  name: string;
  /** Null when stock isn't counted. */
  stock: number | null;
}

export interface DueAlert {
  id: string;
  businessId: string;
  businessName: string;
  waId: string;
  fromNumberId: string | null;
  /** "Flyers: A5" */
  option: string;
  lang: Lang;
}

export interface StockAlertStore {
  /** This business's active option whose id starts with `ref`. */
  option(businessId: string, ref: string): Promise<WaitingOption | null>;
  /** Saves the wait; asking twice keeps one. */
  wait(alert: { businessId: string; variantId: string; contactId: string; waId: string; fromNumberId: string | null }): Promise<void>;
  /** Open waits whose option is active and has stock again (or no longer counts it). */
  due(limit: number): Promise<DueAlert[]>;
  markSent(id: string): Promise<void>;
  /** Drops waits older than STOCK_ALERT_DAYS; returns how many. */
  expire(now: Date): Promise<number>;
}

const SAVED = {
  en: (o: string, b: string) => `Got it. ${b} will message you here as soon as ${o} is back in stock.`,
  fr: (o: string, b: string) => `C'est noté. ${b} vous écrira ici dès que ${o} sera de retour.`,
};
const IN_STOCK = {
  en: (o: string) => `Good news: ${o} is in stock right now. Tell us how many you'd like and we'll send your quote.`,
  fr: (o: string) => `Bonne nouvelle : ${o} est disponible en ce moment. Dites-nous combien vous en voulez et nous vous envoyons le devis.`,
};
export const BACK = {
  en: (o: string, b: string) => `Good news from ${b}: ${o} is back in stock. Reply with how many you'd like and we'll send your quote.`,
  fr: (o: string, b: string) => `Bonne nouvelle de ${b} : ${o} est de retour. Répondez avec la quantité voulue et nous vous envoyons le devis.`,
};

/** Wraps a business's bot so "tell me when it's back" messages from the shop page are saved. */
export function withStockAlerts(inner: Product, opts: { businessId: string; businessName: string; lang: Lang; store: StockAlertStore; log?: Pick<Console, "error"> }): Product {
  const log = opts.log ?? console;
  const lang = opts.lang === "fr" ? "fr" : "en";
  return {
    name: inner.name,
    async handle(msg, ctx) {
      const ref = backInStockRef(msg.text ?? "");
      if (ref) {
        try {
          const option = await opts.store.option(opts.businessId, ref);
          if (option) {
            if (option.stock === 0) {
              await opts.store.wait({ businessId: opts.businessId, variantId: option.variantId, contactId: ctx.contactId, waId: msg.from, fromNumberId: msg.businessNumberId ?? null });
              return { text: SAVED[lang](option.name, opts.businessName) };
            }
            return { text: IN_STOCK[lang](option.name) };
          }
        } catch (err) {
          // E.g. migration 0094 hasn't been run. The bot answers the message as usual.
          log.error("Stock alerts: could not save a wait:", err);
        }
      }
      return inner.handle(msg, ctx);
    },
  };
}

/**
 * Messages customers whose option is back. `send` returns false when the
 * customer can't be reached yet (outside the 24-hour window with no template):
 * the wait stays for a later run.
 */
export async function sendDueStockAlerts(deps: {
  store: StockAlertStore;
  send(alert: DueAlert, text: string): Promise<boolean>;
  now?: Date;
  perRun?: number;
  log?: Pick<Console, "error" | "info">;
}): Promise<number> {
  const log = deps.log ?? console;
  const dropped = await deps.store.expire(deps.now ?? new Date());
  if (dropped) log.info(`Stock alerts: dropped ${dropped} wait(s) older than ${STOCK_ALERT_DAYS} days.`);
  let sent = 0;
  for (const alert of await deps.store.due(deps.perRun ?? 30)) {
    try {
      if (!(await deps.send(alert, BACK[alert.lang === "fr" ? "fr" : "en"](alert.option, alert.businessName)))) continue;
      await deps.store.markSent(alert.id);
      sent++;
    } catch (err) {
      log.error(`Stock alerts: could not message ${alert.waId} about ${alert.option}:`, err);
    }
  }
  return sent;
}

type DueRow = {
  id: string;
  business_id: string;
  wa_id: string;
  from_number_id: string | null;
  quote_variants: { name: string; stock: number | null; active: boolean; quote_products: { name: string; active: boolean } };
  quote_businesses: { name: string; language: string | null; active: boolean };
};

export function createSupabaseStockAlerts(db: SupabaseClient): StockAlertStore {
  return {
    async option(businessId, ref) {
      const { data, error } = await db
        .from("quote_variants")
        .select("id, name, stock, quote_products!inner(name, business_id, active)")
        .eq("active", true)
        .eq("quote_products.business_id", businessId)
        .eq("quote_products.active", true);
      if (error) throw new Error(`stock alert option failed: ${error.message}`);
      const row = (data ?? []).find((v) => String(v.id).replace(/-/g, "").startsWith(ref));
      if (!row) return null;
      const product = row.quote_products as unknown as { name: string };
      return { variantId: row.id as string, name: `${product.name}: ${row.name as string}`, stock: (row.stock as number | null) ?? null };
    },
    async wait(a) {
      const { error } = await db.from("quote_stock_alerts").insert({
        business_id: a.businessId,
        variant_id: a.variantId,
        contact_id: a.contactId,
        wa_id: a.waId,
        from_number_id: a.fromNumberId,
      });
      // 23505: already waiting for this one.
      if (error && error.code !== "23505") throw new Error(`saving a stock alert failed: ${error.message}`);
    },
    async due(limit) {
      const { data, error } = await db
        .from("quote_stock_alerts")
        .select("id, business_id, wa_id, from_number_id, quote_variants!inner(name, stock, active, quote_products!inner(name, active)), quote_businesses!inner(name, language, active)")
        .is("sent_at", null)
        .eq("quote_variants.active", true)
        .or("stock.is.null,stock.gt.0", { referencedTable: "quote_variants" })
        .order("created_at")
        .limit(limit);
      if (error) throw new Error(`due stock alerts failed: ${error.message}`);
      return ((data ?? []) as unknown as DueRow[])
        .filter((r) => r.quote_variants.quote_products.active && r.quote_businesses.active)
        .map((r) => ({
          id: r.id,
          businessId: r.business_id,
          businessName: r.quote_businesses.name,
          waId: r.wa_id,
          fromNumberId: r.from_number_id,
          option: `${r.quote_variants.quote_products.name}: ${r.quote_variants.name}`,
          lang: r.quote_businesses.language === "fr" ? "fr" : "en",
        }));
    },
    async markSent(id) {
      const { error } = await db.from("quote_stock_alerts").update({ sent_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(`marking a stock alert sent failed: ${error.message}`);
    },
    async expire(now) {
      const before = new Date(now.getTime() - STOCK_ALERT_DAYS * 86_400_000).toISOString();
      const { data, error } = await db.from("quote_stock_alerts").delete().is("sent_at", null).lt("created_at", before).select("id");
      if (error) throw new Error(`expiring stock alerts failed: ${error.message}`);
      return (data ?? []).length;
    },
  };
}
