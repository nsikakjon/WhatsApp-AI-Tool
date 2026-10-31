import { timingSafeEqual } from "node:crypto";
import { assertKobo, type PayCurrency } from "../money.js";

// Talks to Flutterwave, which takes Mobile Money (MTN MoMo, Orange Money,
// Moov, Wave) and card payments in CFA francs for businesses in
// French-speaking Africa, and Mobile Money (Ghana) or M-Pesa (Kenya) and card
// payments for yarnOga's own plans in cedis and shillings. Paystack stays in
// charge of naira and US dollar payments.
//
// Flutterwave counts money in currency units (5000 means 5 000 FCFA), while
// we keep hundredths, so amounts are divided by 100 on the way out and
// multiplied by 100 on the way back. CFA prices are always whole francs.

export interface FlutterwaveConfig {
  /** Secret key from Flutterwave > Settings > API Keys. FLWSECK-... or FLWSECK_TEST-... */
  secretKey: string;
  /** The "Secret hash" set under Settings > Webhooks; Flutterwave sends it back in the verif-hash header. */
  secretHash: string;
  apiUrl?: string;
}

export interface FlutterwaveCheckout {
  reference: string;
  /** In hundredths (centimes, pesewas, cents); CFA amounts must be whole francs. */
  amountMinor: number;
  currency: Exclude<PayCurrency, "NGN" | "USD">;
  email: string;
  callbackUrl: string;
  description: string;
  waId: string;
  /** The business's Flutterwave subaccount (RS_...): the money goes to its Mobile Money or bank account. */
  subaccount?: string;
  /** With a subaccount: what yarnOga keeps, in hundredths (whole francs). */
  platformFeeMinor?: number;
}

/** What Flutterwave says about one payment. status is "success" once paid, like Paystack's. */
export interface FlutterwaveTransaction {
  id: string;
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
}

export interface FlutterwaveClient {
  initialize(p: FlutterwaveCheckout): Promise<string>;
  verify(reference: string): Promise<FlutterwaveTransaction>;
}

/** Flutterwave sends our secret hash, as set in its dashboard, in the verif-hash header of every webhook. */
export function isValidFlutterwaveHash(header: string | undefined, secretHash: string): boolean {
  if (!header || !secretHash) return false;
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(secretHash, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function units(minor: number, currency: FlutterwaveCheckout["currency"]): number {
  assertKobo(minor);
  const cfa = currency === "XOF" || currency === "XAF";
  if (cfa && minor % 100 !== 0) throw new Error(`CFA amounts must be whole francs (got ${minor} centimes)`);
  return minor / 100;
}

// The ways to pay offered first in each currency; cards work in all of them.
const PAYMENT_OPTIONS: Record<FlutterwaveCheckout["currency"], string> = {
  XOF: "mobilemoneyfranco,card",
  XAF: "mobilemoneyfranco,card",
  GHS: "mobilemoneyghana,card",
  KES: "mpesa,card",
};

export function createFlutterwaveClient(config: FlutterwaveConfig, fetchImpl: typeof fetch = fetch): FlutterwaveClient {
  const base = (config.apiUrl ?? "https://api.flutterwave.com/v3").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json" };

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: Record<string, unknown> };
    if (!res.ok || body.status !== "success") {
      throw new Error(`Flutterwave ${path.split("?")[0]} failed (${res.status}): ${body.message ?? "no message"}`);
    }
    return body.data ?? {};
  }

  return {
    async initialize(p) {
      const amount = units(p.amountMinor, p.currency);
      const fee = p.subaccount && p.platformFeeMinor ? units(p.platformFeeMinor, p.currency) : 0;
      const data = await call("/payments", {
        method: "POST",
        body: JSON.stringify({
          tx_ref: p.reference,
          amount,
          currency: p.currency,
          redirect_url: p.callbackUrl,
          payment_options: PAYMENT_OPTIONS[p.currency],
          customer: { email: p.email, phonenumber: `+${p.waId}` },
          customizations: { title: "yarnOga", description: p.description },
          meta: { wa_id: p.waId },
          // "flat": the main account (yarnOga) keeps this much; the business gets the rest.
          ...(p.subaccount ? { subaccounts: [{ id: p.subaccount, ...(fee ? { transaction_charge_type: "flat", transaction_charge: fee } : {}) }] } : {}),
        }),
      });
      if (typeof data.link !== "string") throw new Error("Flutterwave didn't return a checkout link");
      return data.link;
    },

    async verify(reference) {
      const data = await call(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
      const status = String(data.status ?? "");
      return {
        id: String(data.id),
        reference: String(data.tx_ref ?? ""),
        status: status === "successful" ? "success" : status,
        // Whole francs back to hundredths, rounding away any stray decimals Flutterwave adds.
        amountMinor: Math.round(Number(data.amount ?? 0) * 100),
        currency: String(data.currency ?? ""),
      };
    },
  };
}
