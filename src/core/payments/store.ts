import type { SupabaseClient } from "@supabase/supabase-js";

// The payments table (migration 0032): one row per checkout link sent.

export interface Payment {
  id: string;
  reference: string;
  product: string;
  waId: string;
  purpose: Record<string, unknown>;
  amountKobo: number;
  status: "pending" | "paid";
}

export interface PaymentStore {
  create(p: Omit<Payment, "id" | "status">): Promise<Payment>;
  byReference(reference: string): Promise<Payment | null>;
  /**
   * Marks a pending payment paid. True only for the one call that flips it,
   * so a webhook that arrives twice can't activate anything twice.
   */
  markPaid(id: string, paystackId: string): Promise<boolean>;
  /** Undoes markPaid when the product couldn't act on it, so a retry can try again. */
  markPending(id: string): Promise<void>;
}

interface Row {
  id: string;
  reference: string;
  product: string;
  wa_id: string;
  purpose: Record<string, unknown> | null;
  amount_kobo: number | string;
  status: "pending" | "paid";
}

const COLUMNS = "id, reference, product, wa_id, purpose, amount_kobo, status";

function toPayment(r: Row): Payment {
  return {
    id: r.id,
    reference: r.reference,
    product: r.product,
    waId: r.wa_id,
    purpose: r.purpose ?? {},
    amountKobo: Number(r.amount_kobo),
    status: r.status,
  };
}

export function createSupabasePaymentStore(db: SupabaseClient): PaymentStore {
  return {
    async create(p) {
      const { data, error } = await db
        .from("payments")
        .insert({ reference: p.reference, product: p.product, wa_id: p.waId, purpose: p.purpose, amount_kobo: p.amountKobo })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`create payment failed: ${error.message}`);
      return toPayment(data as Row);
    },

    async byReference(reference) {
      const { data, error } = await db.from("payments").select(COLUMNS).eq("reference", reference).maybeSingle();
      if (error) throw new Error(`payment lookup failed: ${error.message}`);
      return data ? toPayment(data as Row) : null;
    },

    async markPaid(id, paystackId) {
      const { data, error } = await db
        .from("payments")
        .update({ status: "paid", paystack_id: paystackId, paid_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(`markPaid failed: ${error.message}`);
      return (data ?? []).length === 1;
    },

    async markPending(id) {
      const { error } = await db.from("payments").update({ status: "pending", paystack_id: null, paid_at: null }).eq("id", id);
      if (error) throw new Error(`markPending failed: ${error.message}`);
    },
  };
}
