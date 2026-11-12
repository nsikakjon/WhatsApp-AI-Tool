import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import type { PaymentLinks } from "../../core/payments/payments.js";
import type { Payment } from "../../core/payments/store.js";

// Packs of broadcast messages (migration 0083): a shop pays by Paystack link
// and sends its flyers and offers to the customers who opted in. Pack
// messages are used after the month's own messages and don't run out with
// the month.
//
// Packs and prices are rows in quote_broadcast_packs (kobo), never code. A
// shop on a number in yarnOga's account buys the packs that cover Meta's
// charge; a shop that connected its own account pays Meta itself and buys the
// service-fee packs. Each paid pack is saved under its Paystack reference, so
// a retried webhook never adds it twice. Packs are in naira.

export interface MessagePack {
  code: string;
  name: string;
  messages: number;
  priceKobo: number;
}

export type BilledBy = "yarnoga" | "business";

export interface MessagePackStore {
  /** Packs on sale for shops Meta bills that way, smallest first. */
  packs(billedBy: BilledBy): Promise<MessagePack[]>;
}

export interface MessagePackLedger {
  /** Saves a paid pack and adds its messages; false when this reference was already saved. */
  add(t: { reference: string; businessId: string; packCode: string; messages: number; amountKobo: number }): Promise<boolean>;
}

export interface MessagePacks {
  /** Packs the business can buy (none when it isn't in naira or payments are off). */
  packs(): Promise<MessagePack[]>;
  /** A payment link for a pack, or null when it isn't on sale. */
  link(packCode: string, waId: string): Promise<string | null>;
}

export interface MessagePacksOptions {
  businessId: string;
  store: MessagePackStore;
  /** True when the business connected its own WhatsApp account, so Meta bills the business. */
  ownAccount(): Promise<boolean>;
  /** Leave out when packs can't be sold to this business. */
  links?: PaymentLinks;
  log?: Pick<Console, "error">;
}

export function createMessagePacks(opts: MessagePacksOptions): MessagePacks {
  const log = opts.log ?? console;

  async function packs(): Promise<MessagePack[]> {
    if (!opts.links) return [];
    try {
      return await opts.store.packs((await opts.ownAccount()) ? "business" : "yarnoga");
    } catch (err) {
      // Before migration 0083 is run there are no packs to sell.
      log.error("Could not read the message packs:", err);
      return [];
    }
  }

  return {
    packs,
    async link(packCode, waId) {
      const pack = (await packs()).find((p) => p.code === packCode);
      if (!pack || !opts.links) return null;
      const made = await opts.links.createLink({
        product: "quote",
        waId,
        amountKobo: pack.priceKobo,
        purpose: { kind: "broadcast_pack", businessId: opts.businessId, pack: pack.code, messages: pack.messages },
        title: `yarnOga ${pack.name}`,
      });
      return made.url ?? null;
    },
  };
}

/** What happens once a pack is paid: its messages are added. Returns the owner's thank-you, or null when this payment was already counted. */
export function createMessagePackPaidHandler(ledger: MessagePackLedger): (payment: Payment) => Promise<string | null> {
  return async (payment) => {
    const { businessId, pack, messages } = payment.purpose as { businessId?: unknown; pack?: unknown; messages?: unknown };
    if (typeof businessId !== "string" || typeof pack !== "string" || !Number.isInteger(messages) || (messages as number) < 1) {
      throw new Error(`Payment ${payment.reference} is a message pack we can't read: ${JSON.stringify(payment.purpose)}`);
    }
    const added = await ledger.add({ reference: payment.reference, businessId, packCode: pack, messages: messages as number, amountKobo: payment.amountKobo });
    if (!added) return null;
    return `✅ Payment of ${formatNaira(payment.amountKobo)} received, thank you. ${messages} messages are added. Open a flyer in your app and tap Send to your customers.`;
  };
}

export function createSupabaseMessagePackStore(db: SupabaseClient): MessagePackStore {
  return {
    async packs(billedBy) {
      const { data, error } = await db
        .from("quote_broadcast_packs")
        .select("code, name, messages, price_kobo")
        .eq("active", true)
        .eq("billed_by", billedBy)
        .order("sort_order")
        .order("messages");
      if (error) throw new Error(`Message packs failed: ${error.message}`);
      return (data ?? []).map((r) => ({ code: r.code as string, name: r.name as string, messages: Number(r.messages), priceKobo: Number(r.price_kobo) }));
    },
  };
}

export function createSupabaseMessagePackLedger(db: SupabaseClient): MessagePackLedger {
  return {
    async add(t) {
      const { data, error } = await db.rpc("broadcast_add_pack", {
        p_reference: t.reference,
        p_business_id: t.businessId,
        p_pack_code: t.packCode,
        p_messages: t.messages,
        p_amount_kobo: t.amountKobo,
      });
      if (error) throw new Error(`Saving a message pack failed: ${error.message}`);
      return data === true;
    },
  };
}
