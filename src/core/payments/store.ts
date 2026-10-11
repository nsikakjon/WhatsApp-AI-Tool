import type { SupabaseClient } from "@supabase/supabase-js";

// The payments table (migration 0009): one row per payment link sent.

export interface Payment {
  id: string;
  txRef: string;
  product: string;
  waId: string;
  purpose: Record<string, unknown>;
  amountKobo: number;
  currency: string;
  status: "pending" | "paid";
}

export interface PaymentStore {
  create(p: Omit<Payment, "id" | "status">): Promise<Payment>;
  byRef(txRef: string): Promise<Payment | null>;
  /**
   * Marks a pending payment paid. True only for the one call that flips it,
   * so a webhook that arrives twice can't activate anything twice.
   */
  markPaid(id: string, providerTxId: string): Promise<boolean>;
  /** Undoes markPaid when the product couldn't act on it, so a retry can try again. */
  markPending(id: string): Promise<void>;
}

interface Row {
  id: string;
  tx_ref: string;
  product: string;
  wa_id: string;
  purpose: Record<string, unknown> | null;
  amount_kobo: number | string;
  currency: string;
  status: "pending" | "paid";
}

const COLUMNS = "id, tx_ref, product, wa_id, purpose, amount_kobo, currency, status";

function toPayment(r: Row): Payment {
  return {
    id: r.id,
    txRef: r.tx_ref,
    product: r.product,
    waId: r.wa_id,
    purpose: r.purpose ?? {},
    amountKobo: Number(r.amount_kobo),
    currency: r.currency,
    status: r.status,
  };
}

export function createSupabasePaymentStore(db: SupabaseClient): PaymentStore {
  return {
    async create(p) {
      const { data, error } = await db
        .from("payments")
        .insert({
          tx_ref: p.txRef,
          product: p.product,
          wa_id: p.waId,
          purpose: p.purpose,
          amount_kobo: p.amountKobo,
          currency: p.currency,
        })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`create payment failed: ${error.message}`);
      return toPayment(data as Row);
    },

    async byRef(txRef) {
      const { data, error } = await db.from("payments").select(COLUMNS).eq("tx_ref", txRef).maybeSingle();
      if (error) throw new Error(`payment lookup failed: ${error.message}`);
      return data ? toPayment(data as Row) : null;
    },

    async markPaid(id, providerTxId) {
      const { data, error } = await db
        .from("payments")
        .update({ status: "paid", provider_tx_id: providerTxId, paid_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      if (error) {
        // The same Flutterwave transaction already used for another payment.
        if (error.code === "23505") return false;
        throw new Error(`markPaid failed: ${error.message}`);
      }
      return (data ?? []).length === 1;
    },

    async markPending(id) {
      const { error } = await db
        .from("payments")
        .update({ status: "pending", provider_tx_id: null, paid_at: null })
        .eq("id", id);
      if (error) throw new Error(`markPending failed: ${error.message}`);
    },
  };
}
