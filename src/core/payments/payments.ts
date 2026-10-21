import { randomUUID } from "node:crypto";
import { assertKobo } from "../money.js";
import type { PaystackClient } from "./paystack.js";
import type { Payment, PaymentStore } from "./store.js";

// Checkout links for any product, and what happens once one is paid.
//
// A product asks for a link (having looked the price up in the database); we
// save a pending payment and return Paystack's checkout link. When Paystack
// says a payment went through, we ask Paystack ourselves whether it really was
// paid in full, mark our payment paid (once only) and hand it to the product.

export interface PaymentRequest {
  /** The product asking, e.g. "flyer". Its onPaid handler runs once paid. */
  product: string;
  /** WhatsApp number of the person paying. */
  waId: string;
  /** Looked up from the database by the product; never from the AI. */
  amountKobo: number;
  /** What the payment is for, given back to the product once paid. */
  purpose: Record<string, unknown>;
  /** Shown against the payment in the Paystack dashboard. */
  title: string;
}

/** What products see: they can ask for a link, nothing else. */
export interface PaymentLinks {
  createLink(req: PaymentRequest): Promise<string>;
}

export type OutgoingNote = { to: string; text: string };

/** A product's reaction to a paid payment: the WhatsApp messages to send. */
export type PaidHandler = (payment: Payment) => Promise<OutgoingNote[]>;

export type ConfirmResult = "paid" | "already-paid" | "not-paid" | "unknown";

export interface Payments extends PaymentLinks {
  /** Checks a payment with Paystack and, if it's newly paid, runs the product's onPaid. */
  confirm(reference: string): Promise<ConfirmResult>;
}

export interface PaymentsOptions {
  paystack: PaystackClient;
  store: PaymentStore;
  /** Our thank-you page, where Paystack sends people after paying. */
  callbackUrl: string;
  /** Paystack needs an email for every payment; WhatsApp doesn't give us one. */
  customerEmail: string;
  onPaid: Record<string, PaidHandler>;
  /** Sends a WhatsApp message from the product's own number. */
  send: (product: string, to: string, text: string) => Promise<void>;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function createPayments(opts: PaymentsOptions): Payments {
  const log = opts.log ?? console;

  return {
    async createLink(req) {
      assertKobo(req.amountKobo);
      if (req.amountKobo === 0) throw new Error("Can't take a payment of ₦0");
      if (!opts.onPaid[req.product]) throw new Error(`"${req.product}" has no onPaid handler`);
      const reference = `yarnoga-${req.product}-${randomUUID()}`;
      await opts.store.create({ reference, product: req.product, waId: req.waId, purpose: req.purpose, amountKobo: req.amountKobo });
      return opts.paystack.initialize({
        reference,
        amountKobo: req.amountKobo,
        email: opts.customerEmail,
        callbackUrl: opts.callbackUrl,
        description: req.title,
        waId: req.waId,
      });
    },

    async confirm(reference) {
      const payment = await opts.store.byReference(reference);
      if (!payment) return "unknown";
      if (payment.status === "paid") return "already-paid";

      // Never act on what a webhook or a redirect says: ask Paystack directly.
      const tx = await opts.paystack.verify(reference);
      if (tx.status !== "success") return "not-paid";
      if (tx.currency !== "NGN" || tx.amountKobo < payment.amountKobo) {
        log.error(`Paystack ${tx.id} for ${reference} paid ${tx.currency} ${tx.amountKobo} kobo, expected ${payment.amountKobo}; not activating`);
        return "not-paid";
      }

      if (!(await opts.store.markPaid(payment.id, tx.id))) return "already-paid";

      let notes: OutgoingNote[];
      try {
        notes = await opts.onPaid[payment.product]!(payment);
      } catch (err) {
        // Back to pending so Paystack's retry (or the thank-you page) can try again.
        await opts.store.markPending(payment.id);
        throw err;
      }
      log.info(`Payment ${reference} (${payment.amountKobo} kobo) confirmed, Paystack ${tx.id}`);

      for (const n of notes) {
        try {
          await opts.send(payment.product, n.to, n.text);
        } catch (err) {
          log.error(`Paid, but couldn't message ...${n.to.slice(-4)}:`, err);
        }
      }
      return "paid";
    },
  };
}
