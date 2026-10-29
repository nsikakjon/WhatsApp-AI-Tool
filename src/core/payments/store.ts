import type { SupabaseClient } from "@supabase/supabase-js";
import { isCurrency, type Currency } from "../money.js";

// The payments table (migration 0032): one row per checkout link sent.

export interface Payment {
  id: string;
  reference: string;
  product: string;
  waId: string;
  purpose: Record<string, unknown>;
  amountKobo: number;
  status: "pending" | "paid";
  /** The promo or referral code used on it, if any (migration 0041). */
  promoCode?: string | null;
  /** NGN through Paystack unless set (migration 0052): CFA francs go through Flutterwave. */
  currency?: Currency;
  provider?: PaymentProvider;
}

export type PaymentProvider = "paystack" | "flutterwave";

export type NewPayment = Omit<Payment, "id" | "status" | "promoCode">;

/** What create_promo_payment (migration 0041) says about a code. */
export type PromoCheck =
  | { result: "applied"; code: string; percentOff: number; amountOffKobo: number }
  | { result: "unknown" | "own" | "used" | "full"; code: string; maxUses: number | null };

export interface PaymentStore {
  create(p: NewPayment): Promise<Payment>;
  /**
   * Saves the payment with the code's discount taken off the first month, or
   * saves nothing and says why the code can't be used. One database call, so
   * a code's last place can't go to two people.
   */
  createWithPromo(p: NewPayment, code: string, months: number): Promise<PromoCheck>;
  byReference(reference: string): Promise<Payment | null>;
  /**
   * Marks a pending payment paid. True only for the one call that flips it,
   * so a webhook that arrives twice can't activate anything twice.
   */
  markPaid(id: string, providerId: string, provider?: PaymentProvider): Promise<boolean>;
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
  promo_code?: string | null;
  currency?: string | null;
  provider?: string | null;
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
    promoCode: r.promo_code ?? null,
    currency: isCurrency(r.currency) ? r.currency : "NGN",
    provider: r.provider === "flutterwave" ? "flutterwave" : "paystack",
  };
}

export function createSupabasePaymentStore(db: SupabaseClient): PaymentStore {
  return {
    async create(p) {
      const { data, error } = await db
        .from("payments")
        .insert({
          reference: p.reference,
          product: p.product,
          wa_id: p.waId,
          purpose: p.purpose,
          amount_kobo: p.amountKobo,
          // Only CFA payments name these, so naira payments work before migration 0052 is run.
          ...(p.provider === "flutterwave" ? { currency: p.currency, provider: p.provider } : {}),
        })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`create payment failed: ${error.message}`);
      return toPayment(data as Row);
    },

    async createWithPromo(p, code, months) {
      const { data, error } = await db.rpc("create_promo_payment", {
        p_reference: p.reference,
        p_product: p.product,
        p_wa_id: p.waId,
        p_purpose: p.purpose,
        p_amount_kobo: p.amountKobo,
        p_months: months,
        p_code: code,
      });
      if (error) throw new Error(`create_promo_payment failed: ${error.message}`);
      if (p.provider === "flutterwave") {
        const { error: e } = await db.from("payments").update({ currency: p.currency, provider: p.provider }).eq("reference", p.reference);
        if (e) throw new Error(`payment currency failed: ${e.message}`);
      }
      const row = (data as Array<{ result: PromoCheck["result"]; code: string; percent_off: number | null; amount_off_kobo: number | string | null; max_uses: number | null }>)[0]!;
      return row.result === "applied"
        ? { result: "applied", code: row.code, percentOff: row.percent_off!, amountOffKobo: Number(row.amount_off_kobo) }
        : { result: row.result, code: row.code, maxUses: row.max_uses };
    },

    async byReference(reference) {
      // Every column, so promo_code (migration 0041) is read when it's there.
      const { data, error } = await db.from("payments").select("*").eq("reference", reference).maybeSingle();
      if (error) throw new Error(`payment lookup failed: ${error.message}`);
      return data ? toPayment(data as Row) : null;
    },

    async markPaid(id, providerId, provider = "paystack") {
      const column = provider === "flutterwave" ? "flutterwave_id" : "paystack_id";
      const { data, error } = await db
        .from("payments")
        .update({ status: "paid", [column]: providerId, paid_at: new Date().toISOString() })
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