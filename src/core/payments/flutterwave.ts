import { createHash, timingSafeEqual } from "node:crypto";
import { assertKobo } from "../money.js";

// Talks to Flutterwave, the payment company that takes card, bank transfer and
// USSD payments for us. Two calls are used:
// - make a payment link (a Flutterwave checkout page for one exact amount),
// - look up a transaction, to check for ourselves that it was really paid.

export interface FlutterwaveConfig {
  /** Secret key from Flutterwave > Settings > API keys. Server-only. */
  secretKey: string;
  apiUrl?: string;
}

export interface NewPaymentLink {
  txRef: string;
  amountKobo: number;
  /** Where Flutterwave sends the payer's browser after paying. */
  redirectUrl: string;
  customer: { email: string; phone: string; name?: string };
  /** Shown at the top of the checkout page, e.g. "Duro Flyers: Standard plan". */
  title: string;
  description?: string;
}

/** What Flutterwave says about one transaction. */
export interface FlutterwaveTransaction {
  id: string;
  txRef: string;
  /** "successful", "failed" or "pending". */
  status: string;
  /** What was paid, in kobo. */
  amountKobo: number;
  currency: string;
}

export interface FlutterwaveClient {
  createLink(p: NewPaymentLink): Promise<string>;
  verify(transactionId: string): Promise<FlutterwaveTransaction>;
}

/**
 * Flutterwave wants naira, e.g. 3000 or 3000.5. We convert from whole kobo
 * with integer arithmetic and only turn it into a number at the last moment.
 */
export function koboToNaira(kobo: number): number {
  assertKobo(kobo);
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  return Number(rest ? `${naira}.${String(rest).padStart(2, "0")}` : String(naira));
}

/** The other way: Flutterwave's naira amount back to whole kobo. */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Flutterwave puts the "secret hash" you chose in its dashboard into the
 * verif-hash header of every webhook. Anyone who doesn't know it can't fake one.
 */
export function isValidWebhookHash(header: string | undefined, secretHash: string): boolean {
  if (!header || !secretHash) return false;
  // Compare fixed-length digests so the check takes the same time whatever was sent.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(secretHash).digest();
  return timingSafeEqual(a, b);
}

export function createFlutterwaveClient(config: FlutterwaveConfig, fetchImpl: typeof fetch = fetch): FlutterwaveClient {
  const base = (config.apiUrl ?? "https://api.flutterwave.com/v3").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json" };

  async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.status !== "success") {
      throw new Error(`Flutterwave ${path} failed (${res.status}): ${String(body.message ?? "no message")}`);
    }
    return (body.data ?? {}) as Record<string, unknown>;
  }

  return {
    async createLink(p) {
      const data = await call("/payments", {
        method: "POST",
        body: JSON.stringify({
          tx_ref: p.txRef,
          amount: koboToNaira(p.amountKobo),
          currency: "NGN",
          redirect_url: p.redirectUrl,
          customer: { email: p.customer.email, phonenumber: p.customer.phone, name: p.customer.name ?? p.customer.phone },
          customizations: { title: p.title, description: p.description ?? p.title },
        }),
      });
      if (typeof data.link !== "string") throw new Error("Flutterwave didn't return a payment link");
      return data.link;
    },

    async verify(transactionId) {
      if (!/^\d+$/.test(transactionId)) throw new Error(`Not a Flutterwave transaction id: ${transactionId}`);
      const data = await call(`/transactions/${transactionId}/verify`);
      return {
        id: String(data.id),
        txRef: String(data.tx_ref ?? ""),
        status: String(data.status ?? ""),
        amountKobo: nairaToKobo(Number(data.amount ?? 0)),
        currency: String(data.currency ?? ""),
      };
    },
  };
}
