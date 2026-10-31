import { createHmac, timingSafeEqual } from "node:crypto";
import { assertKobo } from "../money.js";

// Talks to Paystack, which takes card, bank transfer and USSD payments for us.
// Paystack counts money in kobo (or cents for US dollars), like we do, so
// amounts pass through unchanged.

export interface PaystackConfig {
  /** Secret key from Paystack > Settings > API Keys & Webhooks. sk_test_... or sk_live_... */
  secretKey: string;
  apiUrl?: string;
}

export interface NewCheckout {
  reference: string;
  amountKobo: number;
  /** Naira unless set. US dollars need international payments switched on in the Paystack dashboard. */
  currency?: "NGN" | "USD";
  email: string;
  /** Where Paystack sends the payer's browser after paying. */
  callbackUrl: string;
  /** Shown against the payment in the Paystack dashboard. */
  description: string;
  waId: string;
  /** Splits the payment to this subaccount, which bears Paystack's fee. */
  subaccount?: string;
  /** With a subaccount: the kobo that stay with our main account (Paystack's transaction_charge). */
  transactionChargeKobo?: number;
}

/** What Paystack says about one transaction. */
export interface PaystackTransaction {
  id: string;
  reference: string;
  /** "success", "failed", "abandoned", "ongoing", "pending", "reversed". */
  status: string;
  amountKobo: number;
  currency: string;
}

export interface PaystackClient {
  /** Starts a transaction and returns the checkout link to send the payer. */
  initialize(p: NewCheckout): Promise<string>;
  verify(reference: string): Promise<PaystackTransaction>;
}

/**
 * Paystack signs each webhook with an HMAC-SHA512 of the raw body, keyed with
 * our secret key, in the x-paystack-signature header.
 */
export function isValidPaystackSignature(rawBody: string, header: string | undefined, secretKey: string): boolean {
  if (!header || !/^[0-9a-f]+$/i.test(header)) return false;
  const received = Buffer.from(header, "hex");
  const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createPaystackClient(config: PaystackConfig, fetchImpl: typeof fetch = fetch): PaystackClient {
  const base = (config.apiUrl ?? "https://api.paystack.co").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json" };

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: Record<string, unknown> };
    if (!res.ok || body.status !== true) {
      throw new Error(`Paystack ${path} failed (${res.status}): ${body.message ?? "no message"}`);
    }
    return body.data ?? {};
  }

  return {
    async initialize(p) {
      assertKobo(p.amountKobo);
      const data = await call("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          reference: p.reference,
          amount: p.amountKobo,
          currency: p.currency ?? "NGN",
          email: p.email,
          callback_url: p.callbackUrl,
          ...(p.subaccount ? { subaccount: p.subaccount, bearer: "subaccount" } : {}),
          ...(p.subaccount && p.transactionChargeKobo ? { transaction_charge: p.transactionChargeKobo } : {}),
          metadata: {
            wa_id: p.waId,
            custom_fields: [
              { display_name: "For", variable_name: "description", value: p.description },
              { display_name: "WhatsApp", variable_name: "wa_id", value: p.waId },
            ],
          },
        }),
      });
      if (typeof data.authorization_url !== "string") throw new Error("Paystack didn't return a checkout link");
      return data.authorization_url;
    },

    async verify(reference) {
      const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      return {
        id: String(data.id),
        reference: String(data.reference ?? ""),
        status: String(data.status ?? ""),
        amountKobo: Number(data.amount ?? 0),
        currency: String(data.currency ?? ""),
      };
    },
  };
}

/**
 * Nigerian banks as Paystack knows them, and the name on an account, so the
 * owner app can check a bank account before it goes on invoices. The bank
 * list is kept for a day.
 */
export function createPaystackBanks(config: PaystackConfig, fetchImpl: typeof fetch = fetch) {
  const base = (config.apiUrl ?? "https://api.paystack.co").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.secretKey}` };
  let cached: { at: number; list: Array<{ name: string; code: string }> } | null = null;
  return {
    async banks() {
      if (cached && Date.now() - cached.at < 86_400_000) return cached.list;
      const res = await fetchImpl(`${base}/bank?country=nigeria&perPage=100&use_cursor=false`, { headers, signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => ({}))) as { status?: boolean; data?: Array<{ name: string; code: string; active?: boolean }> };
      if (!res.ok || body.status !== true || !Array.isArray(body.data)) throw new Error(`Paystack bank list failed (${res.status})`);
      const list = body.data.filter((b) => b.active !== false).map((b) => ({ name: b.name, code: b.code }));
      cached = { at: Date.now(), list };
      return list;
    },
    async resolve(accountNumber: string, bankCode: string): Promise<string | null> {
      if (!/^\d{10}$/.test(accountNumber) || !/^[0-9A-Za-z]{2,10}$/.test(bankCode)) return null;
      const res = await fetchImpl(`${base}/bank/resolve?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { account_name?: string } };
      return res.ok && body.status === true && body.data?.account_name ? body.data.account_name : null;
    },
  };
}
