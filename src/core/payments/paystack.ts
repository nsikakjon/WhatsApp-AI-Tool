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
  /** Paystack's charge on it, when it says. */
  feesKobo?: number;
  /** The card it was paid with, when Paystack lets us charge it again (reusable card payments only). */
  card?: SavedCard;
}

/** A card Paystack lets us charge again without the payer (charge_authorization). */
export interface SavedCard {
  /** Paystack's AUTH_... code. */
  code: string;
  /** The email the card was saved under; Paystack only charges it with the same email. */
  email: string;
  /** e.g. "Visa ••4081", to show the payer and the owner. */
  label: string;
}

/** A charge on a saved card, same fields as a checkout apart from the card. */
export type SavedCardCharge = Omit<NewCheckout, "callbackUrl" | "email"> & { card: SavedCard };

export interface PaystackClient {
  /** Starts a transaction and returns the checkout link to send the payer. */
  initialize(p: NewCheckout): Promise<string>;
  verify(reference: string): Promise<PaystackTransaction>;
  /**
   * Charges a saved card. "success" and "failed" are final; anything else
   * (e.g. "pending") is settled later by the charge.success webhook.
   */
  chargeCard?(p: SavedCardCharge): Promise<"success" | "failed" | "pending">;
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
      const card = savedCard(data);
      return {
        id: String(data.id),
        reference: String(data.reference ?? ""),
        status: String(data.status ?? ""),
        amountKobo: Number(data.amount ?? 0),
        currency: String(data.currency ?? ""),
        ...(Number.isInteger(data.fees) ? { feesKobo: data.fees as number } : {}),
        ...(card ? { card } : {}),
      };
    },

    async chargeCard(p) {
      assertKobo(p.amountKobo);
      const res = await fetchImpl(`${base}/transaction/charge_authorization`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          reference: p.reference,
          authorization_code: p.card.code,
          email: p.card.email,
          amount: p.amountKobo,
          currency: p.currency ?? "NGN",
          ...(p.subaccount ? { subaccount: p.subaccount, bearer: "subaccount" } : {}),
          ...(p.subaccount && p.transactionChargeKobo ? { transaction_charge: p.transactionChargeKobo } : {}),
          metadata: { wa_id: p.waId, custom_fields: [{ display_name: "For", variable_name: "description", value: p.description }] },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { status?: string } };
      // A clear "no" (a declined card, an expired authorization) charged nothing.
      if (res.status >= 400 && res.status < 500) return "failed";
      if (!res.ok || body.status !== true) throw new Error(`Paystack /transaction/charge_authorization failed (${res.status}): ${body.message ?? "no message"}`);
      const status = body.data?.status;
      return status === "success" ? "success" : status === "failed" ? "failed" : "pending";
    },
  };
}

/** The card on a verified transaction, if Paystack says it can be charged again. */
function savedCard(data: Record<string, unknown>): SavedCard | undefined {
  const auth = data.authorization as Record<string, unknown> | undefined;
  const customer = data.customer as Record<string, unknown> | undefined;
  if (!auth || auth.reusable !== true || auth.channel !== "card" || typeof auth.authorization_code !== "string" || typeof customer?.email !== "string") return undefined;
  const brand = typeof auth.brand === "string" && auth.brand.trim() ? auth.brand.trim() : "Card";
  const last4 = typeof auth.last4 === "string" ? auth.last4 : "";
  return { code: auth.authorization_code, email: customer.email, label: `${brand[0]!.toUpperCase()}${brand.slice(1)}${last4 ? ` ••${last4}` : ""}` };
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

/** What Paystack says about a transfer. "success", "pending", "otp", "failed", "reversed", and a few in-between ones. */
export interface PaystackTransfer {
  status: string;
  transferCode: string | null;
  failure: string | null;
}

export interface PaystackTransfers {
  /** Saves a bank account to send to, and returns Paystack's recipient code (RCP_...). */
  recipient(p: { name: string; accountNumber: string; bankCode: string }): Promise<string>;
  /** Sends naira from our Paystack balance. Paystack refuses a second transfer with the same reference. */
  send(p: { reference: string; amountKobo: number; recipientCode: string; reason: string }): Promise<PaystackTransfer>;
  /** Null when Paystack has no transfer with this reference. */
  verify(reference: string): Promise<PaystackTransfer | null>;
}

/**
 * Paystack Transfers: paying bank accounts from our Paystack balance. Has to
 * be switched on for the account (Paystack > Settings > Preferences), with
 * the OTP for transfers turned off so they go without a code.
 */
export function createPaystackTransfers(config: PaystackConfig, fetchImpl: typeof fetch = fetch): PaystackTransfers {
  const base = (config.apiUrl ?? "https://api.paystack.co").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json" };

  async function call(path: string, init: RequestInit = {}): Promise<{ status: number; ok: boolean; message: string; data: Record<string, unknown> }> {
    const res = await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: Record<string, unknown> };
    return { status: res.status, ok: res.ok && body.status === true, message: body.message ?? "no message", data: body.data ?? {} };
  }
  const read = (data: Record<string, unknown>): PaystackTransfer => ({
    status: String(data.status ?? ""),
    transferCode: typeof data.transfer_code === "string" ? data.transfer_code : null,
    failure: typeof data.failures === "string" ? data.failures : typeof data.reason === "string" && data.status === "failed" ? data.reason : null,
  });

  return {
    async recipient(p) {
      const r = await call("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({ type: "nuban", name: p.name, account_number: p.accountNumber, bank_code: p.bankCode, currency: "NGN" }),
      });
      if (!r.ok || typeof r.data.recipient_code !== "string") throw new Error(`Paystack /transferrecipient failed (${r.status}): ${r.message}`);
      return r.data.recipient_code;
    },

    async send(p) {
      assertKobo(p.amountKobo);
      const r = await call("/transfer", {
        method: "POST",
        body: JSON.stringify({ source: "balance", amount: p.amountKobo, currency: "NGN", recipient: p.recipientCode, reference: p.reference, reason: p.reason.slice(0, 100) }),
      });
      // A clear "no" from Paystack (a 4xx) means nothing was sent. Anything else is unknown until verify says.
      if (!r.ok && r.status >= 400 && r.status < 500) return { status: "failed", transferCode: null, failure: r.message };
      if (!r.ok) throw new Error(`Paystack /transfer failed (${r.status}): ${r.message}`);
      return read(r.data);
    },

    async verify(reference) {
      const r = await call(`/transfer/verify/${encodeURIComponent(reference)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Paystack /transfer/verify failed (${r.status}): ${r.message}`);
      return read(r.data);
    },
  };
}
