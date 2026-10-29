import { randomUUID } from "node:crypto";
import { assertKobo, type Currency } from "../money.js";
import type { Notice } from "../product.js";
import type { FlutterwaveClient } from "./flutterwave.js";
import type { PaystackClient } from "./paystack.js";
import type { Payment, PaymentProvider, PaymentStore, PromoCheck } from "./store.js";

// Checkout links for any product, and what happens once one is paid.
//
// A product asks for a link (having looked the price up in the database); we
// save a pending payment and return a checkout link: Paystack for naira,
// Flutterwave (Mobile Money and cards) for CFA francs. When the provider says
// a payment went through, we ask it ourselves whether it really was paid in
// full, mark our payment paid (once only) and hand it to the product.

export interface PaymentRequest {
  /** The product asking, e.g. "flyer". Its onPaid handler runs once paid. */
  product: string;
  /** WhatsApp number of the person paying. */
  waId: string;
  /** Looked up from the database by the product; never from the AI. In hundredths of `currency`. */
  amountKobo: number;
  /** NGN (the default) goes through Paystack; XOF and XAF through Flutterwave. */
  currency?: Currency;
  /** What the payment is for, given back to the product once paid. */
  purpose: Record<string, unknown>;
  /** Shown against the payment in the Paystack dashboard. */
  title: string;
  /** A promo or referral code the payer typed. Its discount comes off the first of `months`. */
  promo?: { code: string; months: number };
  /**
   * The store's subaccount, where the money goes: Paystack's ACCT_... for
   * naira, Flutterwave's RS_... for CFA francs. The provider's fee comes off its share.
   */
  subaccount?: string;
  /** yarnOga's share of a subaccount payment, in kobo, worked out in code. The store gets the rest. */
  platformFeeKobo?: number;
}

export type AppliedPromo = { code: string; percentOff: number; amountOffKobo: number };
export type RefusedPromo = Exclude<PromoCheck, { result: "applied" }>;

/** A checkout link and what it charges, or no link because the code can't be used. */
export type CheckoutLink =
  | { url: string; amountKobo: number; promo: AppliedPromo | null }
  | { url: null; refused: RefusedPromo };

/** What products see: they can ask for a link, nothing else. */
export interface PaymentLinks {
  createLink(req: PaymentRequest): Promise<CheckoutLink>;
}

/** A WhatsApp message about a payment; from the product's own number unless fromNumberId says otherwise. */
export type OutgoingNote = Notice & { fromNumberId?: string };

/** A product's reaction to a paid payment: the WhatsApp messages to send. */
export type PaidHandler = (payment: Payment) => Promise<OutgoingNote[]>;

export type ConfirmResult = "paid" | "already-paid" | "not-paid" | "unknown";

export interface Payments extends PaymentLinks {
  /** Checks a payment with Paystack and, if it's newly paid, runs the product's onPaid. */
  confirm(reference: string): Promise<ConfirmResult>;
}

export interface PaymentsOptions {
  /** Naira payments; without it, naira links can't be made. */
  paystack?: PaystackClient;
  /** CFA franc payments; without it, CFA links can't be made. */
  flutterwave?: FlutterwaveClient;
  store: PaymentStore;
  /** Our thank-you page, where Paystack sends people after paying. */
  callbackUrl: string;
  /** Paystack needs an email for every payment; this one is used when we don't know the payer's. */
  customerEmail: string;
  /** The payer's own email, if they gave it to us for receipts, so Paystack's receipt reaches them. */
  receiptEmailFor?: (waId: string) => Promise<string | undefined>;
  onPaid: Record<string, PaidHandler>;
  send: (product: string, note: OutgoingNote) => Promise<void>;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function createPayments(opts: PaymentsOptions): Payments {
  const log = opts.log ?? console;

  return {
    async createLink(req) {
      assertKobo(req.amountKobo);
      if (req.amountKobo === 0) throw new Error("Can't take a payment of nothing");
      if (!opts.onPaid[req.product]) throw new Error(`"${req.product}" has no onPaid handler`);
      const currency = req.currency ?? "NGN";
      const provider: PaymentProvider = currency === "NGN" ? "paystack" : "flutterwave";
      if (provider === "paystack" && !opts.paystack) throw new Error("Naira payments need Paystack (PAYSTACK_SECRET_KEY)");
      if (provider === "flutterwave" && !opts.flutterwave) throw new Error("CFA franc payments need Flutterwave (FLUTTERWAVE_SECRET_KEY)");
      const reference = `yarnoga-${req.product}-${randomUUID()}`;
      const payment = {
        reference,
        product: req.product,
        waId: req.waId,
        purpose: req.purpose,
        amountKobo: req.amountKobo,
        ...(provider === "flutterwave" ? { currency, provider } : {}),
      };
      let promo: AppliedPromo | null = null;
      if (req.promo) {
        const check = await opts.store.createWithPromo(payment, req.promo.code, req.promo.months);
        if (check.result !== "applied") return { url: null, refused: check };
        promo = { code: check.code, percentOff: check.percentOff, amountOffKobo: check.amountOffKobo };
      } else {
        await opts.store.create(payment);
      }
      const amountKobo = req.amountKobo - (promo?.amountOffKobo ?? 0);
      const email =
        (await opts.receiptEmailFor?.(req.waId).catch((err) => {
          log.warn("Couldn't look up the payer's receipt email:", err);
          return undefined;
        })) ?? opts.customerEmail;
      if (req.platformFeeKobo) {
        assertKobo(req.platformFeeKobo);
        if (!req.subaccount || req.platformFeeKobo >= amountKobo) throw new Error("A platform fee needs a subaccount and must be less than the payment");
      }
      if (provider === "flutterwave") {
        const url = await opts.flutterwave!.initialize({
          reference,
          amountMinor: amountKobo,
          currency: currency as Exclude<Currency, "NGN">,
          email,
          callbackUrl: opts.callbackUrl,
          description: req.title,
          waId: req.waId,
          subaccount: req.subaccount,
          platformFeeMinor: req.platformFeeKobo || undefined,
        });
        return { url, amountKobo, promo };
      }
      const url = await opts.paystack!.initialize({
        reference,
        amountKobo,
        email,
        callbackUrl: opts.callbackUrl,
        description: req.title,
        waId: req.waId,
        subaccount: req.subaccount,
        transactionChargeKobo: req.platformFeeKobo || undefined,
      });
      return { url, amountKobo, promo };
    },

    async confirm(reference) {
      const payment = await opts.store.byReference(reference);
      if (!payment) return "unknown";
      if (payment.status === "paid") return "already-paid";

      // Never act on what a webhook or a redirect says: ask the provider directly.
      const provider = payment.provider ?? "paystack";
      const currency = payment.currency ?? "NGN";
      const client = provider === "flutterwave" ? opts.flutterwave : opts.paystack;
      if (!client) {
        log.error(`Payment ${reference} is a ${provider} payment, but ${provider} isn't set up`);
        return "not-paid";
      }
      const found = await client.verify(reference);
      const tx = "amountMinor" in found ? { ...found, amountKobo: found.amountMinor } : found;
      if (tx.status !== "success") return "not-paid";
      // Saved after any promo discount, so this is what's due.
      const due = payment.amountKobo;
      if (tx.currency !== currency || tx.amountKobo < due) {
        log.error(`${provider} ${tx.id} for ${reference} paid ${tx.currency} ${tx.amountKobo}, expected ${currency} ${due}; not activating`);
        return "not-paid";
      }

      if (!(await opts.store.markPaid(payment.id, tx.id, provider))) return "already-paid";

      let notes: OutgoingNote[];
      try {
        notes = await opts.onPaid[payment.product]!(payment);
      } catch (err) {
        // Back to pending so Paystack's retry (or the thank-you page) can try again.
        await opts.store.markPending(payment.id);
        throw err;
      }
      log.info(`Payment ${reference} (${currency} ${payment.amountKobo}) confirmed, ${provider} ${tx.id}`);

      for (const n of notes) {
        try {
          await opts.send(payment.product, n);
        } catch (err) {
          log.error(`Paid, but couldn't message ...${n.to.slice(-4)}:`, err);
        }
      }
      return "paid";
    },
  };
}
